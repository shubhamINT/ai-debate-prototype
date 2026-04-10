import {
  Room,
  RoomEvent,
  createLocalTracks,
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.0.2/+esm";

// ── DOM refs ────────────────────────────────────────────────────────────────
const roomLinkInput        = document.querySelector("#room-link");
const copyRoomLinkButton   = document.querySelector("#copy-room-link");
const joinForm             = document.querySelector("#join-form");
const participantNameInput = document.querySelector("#participant-name");
const joinButton           = document.querySelector("#join-button");
const leaveButton          = document.querySelector("#leave-button");
const muteToggleButton     = document.querySelector("#mute-toggle");
const videoToggleButton    = document.querySelector("#video-toggle");
const captionsToggleBtn    = document.querySelector("#captions-toggle");
const roomStatus           = document.querySelector("#room-status");
const roomTitle            = document.querySelector("#room-title");
const reportLink           = document.querySelector("#report-link");
const videoGrid            = document.querySelector("#video-grid");

// Caption overlay refs
const captionOverlay   = document.querySelector("#caption-overlay");
const captionSpeakerEl = document.querySelector("#caption-speaker");
const captionTextEl    = document.querySelector("#caption-text");

// ── State ───────────────────────────────────────────────────────────────────
const roomId = window.location.pathname.split("/").filter(Boolean).at(-1);

let activeRoom          = null;
let localTracks         = [];
let captionSocket       = null;
let activeAudioTrackSid = null;

// Caption state
let captionsEnabled   = true;
let captionFadeTimer  = null;
let captionClearTimer = null;
const captionAccumulator = {}; // itemId → { participantName, text }

// ── Init ────────────────────────────────────────────────────────────────────
roomTitle.textContent = roomId ? `Room ${roomId}` : "Invalid Room";
roomLinkInput.value   = window.location.href;
if (reportLink) {
  reportLink.href = roomId ? `/room/${encodeURIComponent(roomId)}/report` : "#";
}

// ── Status ──────────────────────────────────────────────────────────────────
function setStatus(message, isError = false) {
  roomStatus.textContent = message;
  roomStatus.classList.toggle("error", isError);
}

function copyText(value) {
  return navigator.clipboard.writeText(value);
}

// ── Caption system ──────────────────────────────────────────────────────────
function showCaption(participantName, text) {
  if (!captionsEnabled) return;
  if (captionFadeTimer)  { clearTimeout(captionFadeTimer);  captionFadeTimer  = null; }
  if (captionClearTimer) { clearTimeout(captionClearTimer); captionClearTimer = null; }
  captionSpeakerEl.textContent = participantName;
  captionTextEl.textContent    = text;
  captionOverlay.classList.remove("caption-fading", "caption-empty");
}

function scheduleCaptionFade(delay = 3000) {
  if (captionFadeTimer)  clearTimeout(captionFadeTimer);
  if (captionClearTimer) clearTimeout(captionClearTimer);
  captionFadeTimer = setTimeout(() => {
    captionOverlay.classList.add("caption-fading");
    captionClearTimer = setTimeout(() => {
      captionOverlay.classList.add("caption-empty");
      captionOverlay.classList.remove("caption-fading");
      captionFadeTimer  = null;
      captionClearTimer = null;
    }, 500);
  }, delay);
}

function clearCaptionNow() {
  if (captionFadeTimer)  { clearTimeout(captionFadeTimer);  captionFadeTimer  = null; }
  if (captionClearTimer) { clearTimeout(captionClearTimer); captionClearTimer = null; }
  captionOverlay.classList.add("caption-empty");
  captionOverlay.classList.remove("caption-fading");
  for (const key of Object.keys(captionAccumulator)) delete captionAccumulator[key];
}

function toggleCaptions() {
  captionsEnabled = !captionsEnabled;
  if (captionsEnabled) {
    captionsToggleBtn.classList.add("cc-active");
    captionsToggleBtn.setAttribute("aria-pressed", "true");
    captionsToggleBtn.title = "Hide live captions";
  } else {
    captionsToggleBtn.classList.remove("cc-active");
    captionsToggleBtn.setAttribute("aria-pressed", "false");
    captionsToggleBtn.title = "Show live captions";
    clearCaptionNow();
  }
}

// ── Media controls ──────────────────────────────────────────────────────────
function getLocalTrack(kind) {
  return localTracks.find(({ track }) => track.kind === kind)?.track || null;
}

function updateMediaControlButtons() {
  const audioTrack = getLocalTrack("audio");
  const videoTrack = getLocalTrack("video");
  muteToggleButton.disabled  = !audioTrack;
  videoToggleButton.disabled = !videoTrack;
  muteToggleButton.textContent  = audioTrack?.isMuted ? "Unmute" : "Mute";
  videoToggleButton.textContent = videoTrack?.isMuted ? "Video On" : "Video Off";
}

async function toggleLocalTrack(kind) {
  const track = getLocalTrack(kind);
  if (!track) return;
  const button = kind === "audio" ? muteToggleButton : videoToggleButton;
  button.disabled = true;
  try {
    if (track.isMuted) {
      await track.unmute();
      setStatus(kind === "audio" ? "Microphone is on." : "Camera is on.");
    } else {
      await track.mute();
      setStatus(kind === "audio" ? "Microphone muted." : "Camera turned off.");
    }
  } catch (error) {
    setStatus(error.message || "Unable to update media device state.", true);
  } finally {
    updateMediaControlButtons();
  }
}

// ── Video grid helpers ──────────────────────────────────────────────────────
function clearPlaceholder() {
  videoGrid.querySelector(".video-placeholder")?.remove();
}

function ensurePlaceholder() {
  if (videoGrid.children.length > 0) return;
  const p = document.createElement("article");
  p.className   = "video-placeholder";
  p.textContent = "Camera feeds will appear here after participants join.";
  videoGrid.appendChild(p);
}

function participantLabel(participant, isLocal = false) {
  return participant.name || participant.identity || (isLocal ? "You" : "Guest");
}

function ensureParticipantCard(participantId, label, isLocal = false) {
  clearPlaceholder();
  let card = videoGrid.querySelector(`[data-participant-id="${participantId}"]`);
  if (card) { card.querySelector(".video-name").textContent = label; return card; }

  card = document.createElement("article");
  card.className = "video-card";
  card.dataset.participantId = participantId;

  const media = document.createElement("div");
  media.className = "video-media";

  const meta  = document.createElement("div");
  meta.className = "video-meta";

  const name  = document.createElement("span");
  name.className   = "video-name";
  name.textContent = label;

  const badge = document.createElement("span");
  badge.className   = "video-badge";
  badge.textContent = isLocal ? "You" : "Remote";

  meta.append(name, badge);
  card.append(media, meta);
  videoGrid.appendChild(card);
  return card;
}

function removeParticipantCard(participantId) {
  videoGrid.querySelector(`[data-participant-id="${participantId}"]`)?.remove();
  ensurePlaceholder();
}

function attachTrack(track, participant, isLocal = false) {
  const card  = ensureParticipantCard(
    participant.identity || participant.sid || "local",
    participantLabel(participant, isLocal),
    isLocal,
  );
  const media = card.querySelector(".video-media");
  const el    = track.attach();
  el.dataset.trackSid = track.sid;
  el.dataset.kind     = track.kind;
  el.playsInline = true;
  el.autoplay    = true;
  if (track.kind === "video") {
    media.querySelector('[data-kind="video"]')?.remove();
    media.prepend(el);
  } else {
    media.appendChild(el);
  }
}

function detachTrack(track) {
  track.detach().forEach((el) => el.remove());
}

// ── Caption WebSocket feed ──────────────────────────────────────────────────
function connectCaptionFeed() {
  if (!roomId) return;
  if (captionSocket) captionSocket.close();

  const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
  captionSocket  = new WebSocket(
    `${wsScheme}://${window.location.host}/ws/transcripts/${encodeURIComponent(roomId)}`,
  );

  captionSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);

    // Streaming delta — build text word by word
    if (payload.type === "transcript-delta") {
      const { itemId, participantName, delta } = payload;
      if (!captionAccumulator[itemId]) {
        captionAccumulator[itemId] = { participantName, text: "" };
      }
      captionAccumulator[itemId].text += delta;
      showCaption(participantName, captionAccumulator[itemId].text);
      return;
    }

    // Finalized sentence — show completed text for 3 s then fade
    if (payload.type === "transcript") {
      const { participantName, text } = payload.entry;
      for (const key of Object.keys(captionAccumulator)) delete captionAccumulator[key];
      showCaption(participantName, text);
      scheduleCaptionFade(3000);
      return;
    }

    if (payload.type === "transcription-error") {
      setStatus(payload.message, true);
    }
  });

  captionSocket.addEventListener("close", () => { captionSocket = null; });
}

// ── Transcription API calls ─────────────────────────────────────────────────
async function startTrackTranscription(trackSid, participantIdentity, participantName) {
  const res  = await fetch("/api/transcription/start-track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, trackSid, participantIdentity, participantName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Unable to start transcription.");
  activeAudioTrackSid = trackSid;
}

async function stopTrackTranscription() {
  if (!activeAudioTrackSid) return;
  try {
    await fetch("/api/transcription/stop-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, trackSid: activeAudioTrackSid }),
    });
  } catch (_) { /* best-effort */ } finally {
    activeAudioTrackSid = null;
  }
}

// ── Room events ─────────────────────────────────────────────────────────────
function bindRoomEvents(room) {
  room
    .on(RoomEvent.ParticipantConnected, (p) => {
      ensureParticipantCard(p.identity, participantLabel(p), false);
      setStatus(`${participantLabel(p)} joined.`);
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      removeParticipantCard(p.identity);
      setStatus(`${participantLabel(p)} left.`);
    })
    .on(RoomEvent.TrackSubscribed, (track, _pub, p) => attachTrack(track, p, false))
    .on(RoomEvent.TrackUnsubscribed, (track) => detachTrack(track))
    .on(RoomEvent.Disconnected, () => {
      setStatus("You left the room.");
      videoGrid.replaceChildren();
      ensurePlaceholder();
      activeRoom = null; localTracks = []; activeAudioTrackSid = null;
      updateMediaControlButtons();
      clearCaptionNow();
      if (captionSocket) { captionSocket.close(); captionSocket = null; }
      participantNameInput.disabled = false;
      leaveButton.disabled          = true;
      joinButton.disabled           = false;
    });
}

function renderExistingParticipants(room) {
  room.remoteParticipants.forEach((p) => {
    ensureParticipantCard(p.identity, participantLabel(p), false);
    p.trackPublications.forEach((pub) => { if (pub.track) attachTrack(pub.track, p, false); });
  });
}

async function publishLocalMedia(room, displayName) {
  localTracks = [];
  const tracks = await createLocalTracks({ audio: true, video: true });
  let audioTrackSid = null;
  for (const track of tracks) {
    const pub = await room.localParticipant.publishTrack(track);
    localTracks.push({ track, publication: pub });
    attachTrack(track, { identity: room.localParticipant.identity, name: displayName }, true);
    if (track.kind === "audio") audioTrackSid = pub.trackSid || pub.sid || track.sid || null;
  }
  return { audioTrackSid };
}

async function leaveRoom() {
  await stopTrackTranscription();
  clearCaptionNow();
  for (const { track } of localTracks) { track.stop(); detachTrack(track); }
  localTracks = [];
  updateMediaControlButtons();
  if (captionSocket) { captionSocket.close(); captionSocket = null; }
  if (activeRoom) await activeRoom.disconnect();
  else { videoGrid.replaceChildren(); ensurePlaceholder(); }
}

// ── Event listeners ─────────────────────────────────────────────────────────
copyRoomLinkButton.addEventListener("click", async () => {
  try { await copyText(roomLinkInput.value); setStatus("Room URL copied."); }
  catch (_) { setStatus("Copy failed. Copy the URL manually.", true); }
});

muteToggleButton.addEventListener("click",   () => toggleLocalTrack("audio"));
videoToggleButton.addEventListener("click",  () => toggleLocalTrack("video"));
captionsToggleBtn.addEventListener("click",  toggleCaptions);
leaveButton.addEventListener("click", async () => { leaveButton.disabled = true; await leaveRoom(); });

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!roomId) { setStatus("This room link is invalid.", true); return; }

  const participantName = participantNameInput.value.trim();
  if (!participantName) { setStatus("Enter your name before joining.", true); participantNameInput.focus(); return; }

  joinButton.disabled = true;
  setStatus("Joining room...");

  try {
    const tokenRes  = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, participantName }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.detail || "Unable to join the room.");

    activeRoom = new Room({ adaptiveStream: true, dynacast: true });
    bindRoomEvents(activeRoom);
    await activeRoom.connect(tokenData.livekitUrl, tokenData.token);
    connectCaptionFeed();

    const { audioTrackSid } = await publishLocalMedia(activeRoom, participantName);
    renderExistingParticipants(activeRoom);

    if (audioTrackSid) {
      await startTrackTranscription(audioTrackSid, activeRoom.localParticipant.identity, participantName);
    } else {
      setStatus("Audio track not published — captions unavailable.", true);
    }

    updateMediaControlButtons();
    participantNameInput.disabled = true;
    leaveButton.disabled          = false;
    setStatus("Connected. Anyone with this link can join.");
  } catch (error) {
    if (activeRoom) { await activeRoom.disconnect(); activeRoom = null; }
    setStatus(error.message || "Unable to join the room.", true);
    joinButton.disabled  = false;
    leaveButton.disabled = true;
  }
});

window.addEventListener("beforeunload", () => { if (activeRoom) activeRoom.disconnect(); });

// ── Boot ────────────────────────────────────────────────────────────────────
captionsToggleBtn.classList.add("cc-active");
captionsToggleBtn.setAttribute("aria-pressed", "true");
updateMediaControlButtons();
