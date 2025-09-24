// index.js - SOUL Combat Stage (Full feature, safe stage runtime format)
// Exported handlers: defaultState, onCommand, onMessageBefore, onMessageAfter
// Keep this file in repo root. Do NOT edit files under src/

function defaultState() {
  return {
    combatMode: false,
    turn: 0,
    participants: {},         // name -> {hp, resolve, parasite?, egg?, hidden, status}
    lastMajorEventTurn: -999,
    majorEventCooldown: 10
  };
}

/* --------- Utilities to send UI-style chat messages --------- */
/* send should accept either a string or object depending on your chub runtime.
   Here we assume `send` expects a string message (works with the template runtime). */

function sendPlain(send, text) {
  send(`**[SOUL STAGE]** ${text}`);
}

function sendHUD(send, title, lines) {
  // codeblock style HUD — stands out in chat
  let body = "```";
  body += `\n== ${title} ==\n`;
  for (const L of lines) body += L + "\n";
  body += "```";
  send(body);
}

function bar(value, max, length = 12) {
  const pct = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(pct * length);
  return "▮".repeat(filled) + "▯".repeat(length - filled);
}

function rollDice(spec) {
  spec = (spec || "d20").toLowerCase().trim();
  const parts = spec.split("d");
  const n = parseInt(parts[0]) || 1;
  const s = parseInt(parts[1]) || 20;
  let total = 0, rolls = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(Math.random() * s) + 1;
    rolls.push(r);
    total += r;
  }
  return { total, rolls, sides: s };
}

function ensure(state, name) {
  if (!state.participants[name]) {
    state.participants[name] = {
      hp: 100,
      resolve: 100,
      parasite: null, // {hunger, maxHunger}
      egg: null,      // {incubating, turns, hatched}
      hidden: { strength: "Average", speed: "Average", durability: "Average" },
      status: [],
      isNPC: false
    };
  }
  return state.participants[name];
}

/* --------- Core: onCommand handler (primary interface) --------- */

async function onCommand(commandRaw, argsRaw, user, state, send) {
  if (!state) state = defaultState();
  const cmd = (commandRaw || "").toLowerCase().trim();
  const args = (argsRaw || []).map(a => String(a));

  function pushHUD() {
    const lines = [];
    lines.push(`Combat: ${state.combatMode ? "ON" : "OFF"} | Turn: ${state.turn}`);
    lines.push("");
    if (!Object.keys(state.participants).length) {
      lines.push("No participants yet. Use /add <name> [parasite|egg|npc]");
    } else {
      for (const name of Object.keys(state.participants)) {
        const p = state.participants[name];
        lines.push(`${name} — HP ${p.hp}/100 ${bar(p.hp,100)}`);
        let more = `Resolve ${p.resolve}/100`;
        if (p.parasite) more += `   Parasite ${Math.max(0,p.parasite.hunger)}/${p.parasite.maxHunger} ${bar(p.parasite.hunger,p.parasite.maxHunger,8)}`;
        if (p.egg) {
          const eggs = p.egg.hatched ? "HATCHED" : (p.egg.incubating ? `Incubating(${p.egg.turns}t)` : "Dormant");
          more += `   Egg: ${eggs}`;
        }
        lines.push(more);
        if (p.status && p.status.length) lines.push(`Status: ${p.status.join(", ")}`);
        lines.push("");
      }
    }
    sendHUD(send, "SOUL HUD", lines);
  }

  /* --------- commands --------- */
  if (cmd === "help") {
    sendPlain(send, "Commands: /combat on|off, /add <name> [parasite|egg|npc], /status, /feed <name> <amt>, /burst <name>, /incubate <name> [turns], /nextturn, /roll dX, /awaken <name>");
    return state;
  }

  if (cmd === "combat") {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "on") {
      state.combatMode = true;
      state.turn = 1;
      sendPlain(send, "⚔️ Combat mode ACTIVATED");
      pushHUD();
      return state;
    } else if (sub === "off") {
      state.combatMode = false;
      sendPlain(send, "🛑 Combat mode ENDED");
      pushHUD();
      return state;
    } else {
      sendPlain(send, "Usage: /combat on OR /combat off");
      return state;
    }
  }

  if (cmd === "add") {
    const name = args[0];
    if (!name) { sendPlain(send, "Usage: /add <name> [parasite|egg|npc]"); return state; }
    const p = ensure(state, name);
    if (args.includes("parasite")) p.parasite = { hunger: 70, maxHunger: 100 };
    if (args.includes("egg")) p.egg = { incubating: false, turns: 3, hatched: false };
    if (args.includes("npc")) p.isNPC = true;
    sendPlain(send, `${name} added to the encounter${p.isNPC ? " (NPC)" : ""}${p.parasite ? " (parasite)" : ""}${p.egg ? " (egg)" : ""}.`);
    pushHUD();
    return state;
  }

  if (cmd === "status") {
    pushHUD();
    return state;
  }

  if (cmd === "roll") {
    const spec = args[0] || "d20";
    const r = rollDice(spec);
    if (!r) { sendPlain(send, "Dice parse error"); return state; }
    sendPlain(send, `🎲 Roll ${spec}: [${r.rolls.join(", ")}] = ${r.total}`);
    // hint particle on big roll
    if (r.total >= (r.sides * Math.max(1, Math.round(r.rolls.length/2)))) {
      const names = Object.keys(state.participants);
      if (names.length) {
        const who = names[Math.floor(Math.random()*names.length)];
        state.participants[who].particle = true;
        sendPlain(send, `✨ ${who} senses a shimmering pre-awakening aura.`);
      }
    }
    return state;
  }

  if (cmd === "feed") {
    const who = args[0] || "Sera";
    const amt = parseInt(args[1] || "20", 10) || 20;
    const p = state.participants[who];
    if (!p) { sendPlain(send, `${who} not found.`); return state; }
    if (!p.parasite) { sendPlain(send, `${who} has no parasite.`); return state; }
    p.parasite.hunger = Math.min(p.parasite.maxHunger, p.parasite.hunger + amt);
    const heal = Math.max(1, Math.floor((amt/2) * (0.5 + (p.resolve/200))));
    p.hp = Math.min(100, p.hp + heal);
    p.resolve = Math.min(150, p.resolve + Math.floor(heal/2));
    sendPlain(send, `🍖 ${who} feeds parasite (+${amt} hunger). Heals ${heal} HP. Hunger: ${p.parasite.hunger}/${p.parasite.maxHunger}`);
    pushHUD();
    return state;
  }

  if (cmd === "burst") {
    const who = args[0] || "Sera";
    const p = state.participants[who];
    if (!p || !p.parasite) { sendPlain(send, "No valid parasite host."); return state; }
    const selfDmg = 15, burstDmg = 40;
    p.hp = Math.max(0, p.hp - selfDmg);
    const others = Object.keys(state.participants).filter(n => n !== who);
    if (!others.length) { sendPlain(send, `${who} bursts but hits nothing. (self damage ${selfDmg})`); pushHUD(); return state; }
    const target = others[Math.floor(Math.random()*others.length)];
    state.participants[target].hp = Math.max(0, state.participants[target].hp - burstDmg);
    p.parasite.hunger = Math.min(p.parasite.maxHunger, p.parasite.hunger + 10);
    sendPlain(send, `💥 ${who} chest-bursts! ${target} takes ${burstDmg} piercing. ${who} takes ${selfDmg}.`);
    pushHUD();
    return state;
  }

  if (cmd === "incubate") {
    const who = args[0] || "Malik";
    const p = state.participants[who];
    if (!p || !p.egg) { sendPlain(send, `${who} has no egg.`); return state; }
    if (p.egg.hatched) { sendPlain(send, `Egg already hatched.`); return state; }
    p.egg.incubating = true;
    p.egg.turns = parseInt(args[1] || "3",10) || 3;
    sendPlain(send, `🥚 ${who} begins incubating an egg for ${p.egg.turns} turns.`);
    pushHUD();
    return state;
  }

  if (cmd === "nextturn") {
    state.turn = (state.turn || 0) + 1;
    for (const name of Object.keys(state.participants)) {
      const p = state.participants[name];
      if (p.parasite) {
        p.parasite.hunger = Math.max(0, p.parasite.hunger - 3);
        if (p.parasite.hunger === 0) {
          p.hp = Math.max(0, p.hp - 8);
          if (!p.status.includes("Parasite starving")) p.status.push("Parasite starving");
        }
      }
      if (p.egg && p.egg.incubating && !p.egg.hatched) {
        p.egg.turns -= 1;
        if (p.egg.turns <= 0) {
          p.egg.hatched = true;
          p.egg.incubating = false;
          p.status.push("Egg hatched into a Beast");
          sendPlain(send, `🐲 Major Event: ${name}'s egg hatches into a beast!`);
        }
      }
      if (p.hp < 30) p.resolve = Math.max(0, p.resolve - 5);
    }
    // major event chance
    if ((state.turn - state.lastMajorEventTurn) >= state.majorEventCooldown) {
      if (Math.random() < 0.03) {
        state.lastMajorEventTurn = state.turn;
        sendPlain(send, "🎺 MAJOR EVENT: An unexpected figure arrives on the field.");
      }
    }
    sendPlain(send, `➡️ Turn ${state.turn} processed.`);
    // HUD
    (function pushHUD(){ const lines=[]; lines.push(`Turn ${state.turn}`); for(const n of Object.keys(state.participants)){ const p=state.participants[n]; lines.push(`${n}: HP ${p.hp}/100 ${bar(p.hp,100)} ${p.parasite?` Parasite ${p.parasite.hunger}/${p.parasite.maxHunger}`:""}`);} sendHUD(send,"SOUL HUD",lines); })();
    return state;
  }

  if (cmd === "awaken") {
    const who = args[0];
    if (!who) { sendPlain(send, "Usage: /awaken <name>"); return state; }
    const p = state.participants[who];
    if (!p) { sendPlain(send, `${who} not found.`); return state; }
    if (!p.particle && p.resolve < 90) { sendPlain(send, `${who} is not ready to awaken.`); return state; }
    p.status.push("Awakened");
    p.hp = Math.min(150, p.hp + 20);
    p.resolve = Math.min(200, p.resolve + 30);
    p.hidden.strength = "High";
    delete p.particle;
    sendPlain(send, `🌈 ${who} EXPERIENCES AN AWAKENING — stats increased!`);
    pushHUD();
    return state;
  }

  // default fallback
  sendPlain(send, `Unknown command: /${cmd} — use /help`);
  return state;
}

/* ---------- message hooks (kept minimal) ---------- */
async function onMessageBefore(message, user, state, send) {
  return state || defaultState();
}

async function onMessageAfter(message, user, state, send) {
  return state || defaultState();
}

/* ---------- exports ---------- */
module.exports = {
  defaultState,
  onCommand,
  onMessageBefore,
  onMessageAfter
};
