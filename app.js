"use strict";

/* ============================================================
 * Storage — localStorage helpers (no DOM code here)
 * ============================================================ */
const Storage = (() => {
  const KEYS = {
    characters: "bronzechat.characters",
    chats: "bronzechat.chats",       // { [characterId]: message[] }  (Me ↔ character)
    duoChats: "bronzechat.duoChats", // { [duoId]: { a, b, messages } } (character ↔ character)
    active: "bronzechat.active",     // { type: "solo" | "duo", id }
    legacyActiveId: "bronzechat.activeId",
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  return {
    getCharacters: () => read(KEYS.characters, []),
    saveCharacters: (list) => write(KEYS.characters, list),

    getChat: (characterId) => read(KEYS.chats, {})[characterId] || [],
    saveChat(characterId, messages) {
      const chats = read(KEYS.chats, {});
      chats[characterId] = messages;
      write(KEYS.chats, chats);
    },
    deleteChat(characterId) {
      const chats = read(KEYS.chats, {});
      delete chats[characterId];
      write(KEYS.chats, chats);
    },

    getDuos: () => read(KEYS.duoChats, {}),
    getDuo: (duoId) => read(KEYS.duoChats, {})[duoId] || null,
    saveDuo(duoId, duo) {
      const duos = read(KEYS.duoChats, {});
      duos[duoId] = duo;
      write(KEYS.duoChats, duos);
    },
    deleteDuo(duoId) {
      const duos = read(KEYS.duoChats, {});
      delete duos[duoId];
      write(KEYS.duoChats, duos);
    },
    deleteDuosInvolving(characterId) {
      const duos = read(KEYS.duoChats, {});
      for (const id of Object.keys(duos)) {
        if (duos[id].a === characterId || duos[id].b === characterId) delete duos[id];
      }
      write(KEYS.duoChats, duos);
    },

    getActive: () => read(KEYS.active, null),
    saveActive: (active) => write(KEYS.active, active),

    /** One-time migration from the pre-duo storage format. */
    takeLegacyActiveId() {
      const id = read(KEYS.legacyActiveId, null);
      localStorage.removeItem(KEYS.legacyActiveId);
      return id;
    },
  };
})();

/* ============================================================
 * App state
 * ============================================================ */
const state = {
  characters: Storage.getCharacters(),
  active: Storage.getActive(), // { type: "solo" | "duo", id } | null
  speaker: "user",             // solo: "user" | "character"; duo: a character id
};

if (!state.active) {
  const legacyId = Storage.takeLegacyActiveId();
  if (legacyId) {
    state.active = { type: "solo", id: legacyId };
    Storage.saveActive(state.active);
  }
}

/* ============================================================
 * DOM references
 * ============================================================ */
const el = {
  app: document.querySelector(".app"),
  characterList: document.getElementById("characterList"),
  duoList: document.getElementById("duoList"),
  duoLabel: document.getElementById("duoLabel"),
  sidebarEmpty: document.getElementById("sidebarEmpty"),
  addCharacterBtn: document.getElementById("addCharacterBtn"),
  addPairBtn: document.getElementById("addPairBtn"),

  chatPlaceholder: document.getElementById("chatPlaceholder"),
  chatActive: document.getElementById("chatActive"),
  backBtn: document.getElementById("backBtn"),
  topbarAvatars: document.getElementById("topbarAvatars"),
  topbarName: document.getElementById("topbarName"),
  topbarBio: document.getElementById("topbarBio"),
  deleteBtn: document.getElementById("deleteBtn"),

  messageContainer: document.getElementById("messageContainer"),
  messageForm: document.getElementById("messageForm"),
  messageInput: document.getElementById("messageInput"),
  speakerToggle: document.getElementById("speakerToggle"),

  characterModal: document.getElementById("characterModal"),
  characterForm: document.getElementById("characterForm"),
  charName: document.getElementById("charName"),
  charAvatar: document.getElementById("charAvatar"),
  charBio: document.getElementById("charBio"),
  cancelModalBtn: document.getElementById("cancelModalBtn"),

  pairModal: document.getElementById("pairModal"),
  pairForm: document.getElementById("pairForm"),
  pairCharA: document.getElementById("pairCharA"),
  pairCharB: document.getElementById("pairCharB"),
  pairHint: document.getElementById("pairHint"),
  cancelPairBtn: document.getElementById("cancelPairBtn"),
};

/* ============================================================
 * Helpers
 * ============================================================ */
function getCharacter(id) {
  return state.characters.find((c) => c.id === id) || null;
}

/**
 * Resolve state.active into a full conversation object, or null if it
 * points at something that no longer exists.
 *  - solo: { type: "solo", character }
 *  - duo:  { type: "duo", id, a, b }  (a and b are character objects)
 */
function getActiveConversation() {
  if (!state.active) return null;
  if (state.active.type === "solo") {
    const character = getCharacter(state.active.id);
    return character ? { type: "solo", character } : null;
  }
  const duo = Storage.getDuo(state.active.id);
  if (!duo) return null;
  const a = getCharacter(duo.a);
  const b = getCharacter(duo.b);
  return a && b ? { type: "duo", id: state.active.id, a, b } : null;
}

/** The selectable speakers for a conversation, in toggle order. */
function speakerOptions(convo) {
  if (convo.type === "solo") {
    return [
      { key: "user", label: "Me" },
      { key: "character", label: convo.character.name },
    ];
  }
  return [
    { key: convo.a.id, label: convo.a.name },
    { key: convo.b.id, label: convo.b.name },
  ];
}

function getMessages(convo) {
  if (convo.type === "solo") return Storage.getChat(convo.character.id);
  const duo = Storage.getDuo(convo.id);
  return duo ? duo.messages : [];
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

/** Build an avatar node: image if a URL is set, otherwise the initial. */
function buildAvatar(character, sizeClass) {
  const div = document.createElement("div");
  div.className = `avatar ${sizeClass}`;
  if (character.avatar) {
    const img = document.createElement("img");
    img.src = character.avatar;
    img.alt = character.name;
    img.onerror = () => {
      img.remove();
      div.textContent = character.name.charAt(0).toUpperCase();
    };
    div.appendChild(img);
  } else {
    div.textContent = character.name.charAt(0).toUpperCase();
  }
  return div;
}

/* ============================================================
 * Rendering
 * ============================================================ */
function renderSidebar() {
  el.characterList.replaceChildren();
  el.sidebarEmpty.hidden = state.characters.length > 0;

  for (const character of state.characters) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "character-item";
    if (state.active && state.active.type === "solo" && state.active.id === character.id) {
      item.classList.add("is-active");
    }
    item.addEventListener("click", () => selectConversation({ type: "solo", id: character.id }));

    const name = document.createElement("span");
    name.className = "character-item__name";
    name.textContent = character.name;

    item.append(buildAvatar(character, "avatar--sm"), name);
    el.characterList.appendChild(item);
  }

  renderDuoList();
}

function renderDuoList() {
  el.duoList.replaceChildren();
  const duos = Storage.getDuos();
  const entries = Object.entries(duos).filter(
    ([, duo]) => getCharacter(duo.a) && getCharacter(duo.b)
  );
  el.duoLabel.hidden = entries.length === 0;

  for (const [duoId, duo] of entries) {
    const a = getCharacter(duo.a);
    const b = getCharacter(duo.b);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "character-item";
    if (state.active && state.active.type === "duo" && state.active.id === duoId) {
      item.classList.add("is-active");
    }
    item.addEventListener("click", () => selectConversation({ type: "duo", id: duoId }));

    const stack = document.createElement("span");
    stack.className = "avatar-stack";
    stack.append(buildAvatar(a, "avatar--sm"), buildAvatar(b, "avatar--sm"));

    const name = document.createElement("span");
    name.className = "character-item__name";
    name.textContent = `${a.name} × ${b.name}`;

    item.append(stack, name);
    el.duoList.appendChild(item);
  }
}

function renderTopbar(convo) {
  el.topbarAvatars.replaceChildren();
  if (convo.type === "solo") {
    el.topbarAvatars.append(buildAvatar(convo.character, "avatar--md"));
    el.topbarName.textContent = convo.character.name;
    el.topbarBio.textContent = convo.character.bio || "";
    el.deleteBtn.textContent = "Delete";
    el.deleteBtn.title = "Delete this character and all their chats";
  } else {
    el.topbarAvatars.append(
      buildAvatar(convo.a, "avatar--md"),
      buildAvatar(convo.b, "avatar--md")
    );
    el.topbarName.textContent = `${convo.a.name} × ${convo.b.name}`;
    el.topbarBio.textContent = "Character × character conversation";
    el.deleteBtn.textContent = "Delete Chat";
    el.deleteBtn.title = "Delete this conversation (the characters stay)";
  }
}

function renderSpeakerToggle(convo) {
  const options = speakerOptions(convo);
  if (!options.some((o) => o.key === state.speaker)) {
    state.speaker = options[0].key;
  }

  el.speakerToggle.replaceChildren();
  for (const option of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "speaker-toggle__option";
    btn.dataset.speaker = option.key;
    btn.textContent = option.label;
    btn.setAttribute("role", "radio");
    const active = option.key === state.speaker;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", String(active));
    el.speakerToggle.appendChild(btn);
  }

  updateInputPlaceholder(convo);
}

function renderMessages(convo) {
  el.messageContainer.replaceChildren();

  for (const msg of getMessages(convo)) {
    let side; // "right" = second party, "left" = first party
    let label;
    if (convo.type === "solo") {
      side = msg.sender === "user" ? "right" : "left";
      label = msg.sender === "user" ? "Me" : convo.character.name;
    } else {
      side = msg.sender === convo.b.id ? "right" : "left";
      const speaker = getCharacter(msg.sender);
      label = speaker ? speaker.name : "Unknown";
    }

    const wrapper = document.createElement("div");
    wrapper.className = `message message--${side}`;

    const bubble = document.createElement("div");
    bubble.className = "message__bubble";
    bubble.textContent = msg.text;

    const meta = document.createElement("div");
    meta.className = "message__meta";
    meta.textContent = `${label} · ${formatTimestamp(msg.ts)}`;

    wrapper.append(bubble, meta);
    el.messageContainer.appendChild(wrapper);
  }

  scrollToBottom();
}

function renderChatArea() {
  const convo = getActiveConversation();
  el.app.classList.toggle("is-chatting", Boolean(convo));
  el.chatPlaceholder.hidden = Boolean(convo);
  el.chatActive.hidden = !convo;
  if (!convo) return;

  renderTopbar(convo);
  renderSpeakerToggle(convo);
  renderMessages(convo);
}

function renderAll() {
  renderSidebar();
  renderChatArea();
}

function scrollToBottom() {
  el.messageContainer.scrollTop = el.messageContainer.scrollHeight;
}

function updateInputPlaceholder(convo) {
  const options = speakerOptions(convo);
  const current = options.find((o) => o.key === state.speaker) || options[0];
  el.messageInput.placeholder = `Type a message as ${current.label}…`;
}

/* ============================================================
 * Actions
 * ============================================================ */
function selectConversation(active) {
  state.active = active;
  Storage.saveActive(active);
  renderAll();
  el.messageInput.focus();
}

function addCharacter(name, avatar, bio) {
  const character = {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    avatar,
    bio,
  };
  state.characters.push(character);
  Storage.saveCharacters(state.characters);
  selectConversation({ type: "solo", id: character.id });
}

function startDuoChat(idA, idB) {
  // One conversation per pair: a deterministic id regardless of pick order.
  const duoId = `d_${[idA, idB].sort().join("_")}`;
  if (!Storage.getDuo(duoId)) {
    Storage.saveDuo(duoId, { a: idA, b: idB, messages: [] });
  }
  selectConversation({ type: "duo", id: duoId });
}

function deleteActiveConversation() {
  const convo = getActiveConversation();
  if (!convo) return;

  if (convo.type === "solo") {
    const character = convo.character;
    const ok = confirm(
      `Delete "${character.name}"? This removes the character, your chat with them, ` +
        `and any character × character chats they are part of. This cannot be undone.`
    );
    if (!ok) return;
    state.characters = state.characters.filter((c) => c.id !== character.id);
    Storage.saveCharacters(state.characters);
    Storage.deleteChat(character.id);
    Storage.deleteDuosInvolving(character.id);
  } else {
    const ok = confirm(
      `Delete the chat between "${convo.a.name}" and "${convo.b.name}"? ` +
        `The characters themselves are kept. This cannot be undone.`
    );
    if (!ok) return;
    Storage.deleteDuo(convo.id);
  }

  state.active = null;
  Storage.saveActive(null);
  renderAll();
}

function sendMessage(text) {
  const convo = getActiveConversation();
  if (!convo || !text.trim()) return;

  const msg = { sender: state.speaker, text: text.trim(), ts: Date.now() };
  if (convo.type === "solo") {
    const messages = Storage.getChat(convo.character.id);
    messages.push(msg);
    Storage.saveChat(convo.character.id, messages);
  } else {
    const duo = Storage.getDuo(convo.id);
    duo.messages.push(msg);
    Storage.saveDuo(convo.id, duo);
  }

  renderMessages(convo);
}

function setSpeaker(speakerKey) {
  state.speaker = speakerKey;
  const convo = getActiveConversation();
  if (convo) renderSpeakerToggle(convo);
  el.messageInput.focus();
}

/* ============================================================
 * Modals
 * ============================================================ */
function openCharacterModal() {
  el.characterForm.reset();
  el.characterModal.hidden = false;
  el.charName.focus();
}

function closeCharacterModal() {
  el.characterModal.hidden = true;
}

function openPairModal() {
  if (state.characters.length < 2) {
    alert("Create at least two characters first, then they can chat with each other.");
    return;
  }
  el.pairHint.hidden = true;

  for (const select of [el.pairCharA, el.pairCharB]) {
    select.replaceChildren();
    for (const character of state.characters) {
      const option = document.createElement("option");
      option.value = character.id;
      option.textContent = character.name;
      select.appendChild(option);
    }
  }
  el.pairCharA.value = state.characters[0].id;
  el.pairCharB.value = state.characters[1].id;

  el.pairModal.hidden = false;
  el.pairCharA.focus();
}

function closePairModal() {
  el.pairModal.hidden = true;
}

/* ============================================================
 * Event wiring
 * ============================================================ */
el.addCharacterBtn.addEventListener("click", openCharacterModal);
el.cancelModalBtn.addEventListener("click", closeCharacterModal);
el.addPairBtn.addEventListener("click", openPairModal);
el.cancelPairBtn.addEventListener("click", closePairModal);

el.characterModal.addEventListener("click", (e) => {
  if (e.target === el.characterModal) closeCharacterModal();
});

el.pairModal.addEventListener("click", (e) => {
  if (e.target === el.pairModal) closePairModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!el.characterModal.hidden) closeCharacterModal();
  if (!el.pairModal.hidden) closePairModal();
});

el.characterForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el.charName.value.trim();
  if (!name) return;
  addCharacter(name, el.charAvatar.value.trim(), el.charBio.value.trim());
  closeCharacterModal();
});

el.pairForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const idA = el.pairCharA.value;
  const idB = el.pairCharB.value;
  if (idA === idB) {
    el.pairHint.hidden = false;
    return;
  }
  startDuoChat(idA, idB);
  closePairModal();
});

el.messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(el.messageInput.value);
  el.messageInput.value = "";
  el.messageInput.focus();
});

el.speakerToggle.addEventListener("click", (e) => {
  const option = e.target.closest(".speaker-toggle__option");
  if (option) setSpeaker(option.dataset.speaker);
});

el.deleteBtn.addEventListener("click", deleteActiveConversation);

el.backBtn.addEventListener("click", () => {
  state.active = null;
  Storage.saveActive(null);
  renderAll();
});

/* ============================================================
 * Init
 * ============================================================ */
renderAll();
