import {
  Room,
  RoomEvent,
  createLocalTracks,
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.0.2/+esm";

const roomLinkInput = document.querySelector("#room-link");
const copyRoomLinkButton = document.querySelector("#copy-room-link");
const joinForm = document.querySelector("#join-form");
const participantNameInput = document.querySelector("#participant-name");
const joinButton = document.querySelector("#join-button");
const leaveButton = document.querySelector("#leave-button");
const roomStatus = document.querySelector("#room-status");
const roomTitle = document.querySelector("#room-title");
const videoGrid = document.querySelector("#video-grid");
const transcriptStatus = document.querySelector("#transcript-status");
const transcriptList = document.querySelector("#transcript-list");

const roomId = window.location.pathname.split("/").filter(Boolean).at(-1);
const seenTranscriptSequences = new Set();

let activeRoom = null;
let localTracks = [];
let captionSocket = null;
let activeAudioTrackSid = null;

roomTitle.textContent = roomId ? `Room ${roomId}` : "Invalid Room";
roomLinkInput.value = window.location.href;

function setStatus(message, isError = false) {
  roomStatus.textContent = message;
  roomStatus.classList.toggle("error", isError);
}

function setTranscriptStatus(message, isError = false) {
  transcriptStatus.textContent = message;
  transcriptStatus.classList.toggle("error", isError);
}

function copyText(value) {
  return navigator.clipboard.writeText(value);
}

function clearPlaceholder() {
  const placeholder = videoGrid.querySelector(".video-placeholder");
  if (placeholder) {
    placeholder.remove();
  }
}

function ensurePlaceholder() {
  if (videoGrid.children.length > 0) {
    return;
  }

  const placeholder = document.createElement("article");
  placeholder.className = "video-placeholder";
  placeholder.textContent = "Camera feeds will appear here after participants join.";
  videoGrid.appendChild(placeholder);
}

function clearTranscriptPlaceholder() {
  const placeholder = transcriptList.querySelector(".transcript-placeholder");
  if (placeholder) {
    placeholder.remove();
  }
}

function ensureTranscriptPlaceholder() {
  if (transcriptList.children.length > 0) {
    return;
  }

  const placeholder = document.createElement("article");
  placeholder.className = "transcript-placeholder";
  placeholder.textContent = "Finalized transcript lines will show up here.";
  transcriptList.appendChild(placeholder);
}

function participantLabel(participant, isLocal = false) {
  return participant.name || participant.identity || (isLocal ? "You" : "Guest");
}

function ensureParticipantCard(participantId, label, isLocal = false) {
  clearPlaceholder();

  let card = videoGrid.querySelector(`[data-participant-id="${participantId}"]`);
  if (card) {
    card.querySelector(".video-name").textContent = label;
    return card;
  }

  card = document.createElement("article");
  card.className = "video-card";
  card.dataset.participantId = participantId;

  const media = document.createElement("div");
  media.className = "video-media";
  card.appendChild(media);

  const meta = document.createElement("div");
  meta.className = "video-meta";

  const name = document.createElement("span");
  name.className = "video-name";
  name.textContent = label;

  const badge = document.createElement("span");
  badge.className = "video-badge";
  badge.textContent = isLocal ? "You" : "Remote";

  meta.append(name, badge);
  card.appendChild(meta);
  videoGrid.appendChild(card);
  return card;
}

function removeParticipantCard(participantId) {
  const card = videoGrid.querySelector(`[data-participant-id="${participantId}"]`);
  if (card) {
    card.remove();
  }
  ensurePlaceholder();
}

function attachTrack(track, participant, isLocal = false) {
  const participantId = participant.identity || participant.sid || "local";
  const card = ensureParticipantCard(
    participantId,
    participantLabel(participant, isLocal),
    isLocal,
  );
  const media = card.querySelector(".video-media");
  const attached = track.attach();
  attached.dataset.trackSid = track.sid;
  attached.dataset.kind = track.kind;
  attached.playsInline = true;
  attached.autoplay = true;

  if (track.kind === "video") {
    const oldVideo = media.querySelector('[data-kind="video"]');
    if (oldVideo) {
      oldVideo.remove();
    }
    media.prepend(attached);
  } else {
    media.appendChild(attached);
  }
}

function detachTrack(track) {
  track.detach().forEach((element) => element.remove());
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function appendTranscriptEntry(entry) {
  if (!entry || seenTranscriptSequences.has(entry.sequence)) {
    return;
  }

  seenTranscriptSequences.add(entry.sequence);
  clearTranscriptPlaceholder();

  const item = document.createElement("article");
  item.className = "transcript-entry";
  item.dataset.sequence = String(entry.sequence);

  const meta = document.createElement("div");
  meta.className = "transcript-entry-meta";

  const speaker = document.createElement("span");
  speaker.className = "transcript-speaker";
  speaker.textContent = entry.participantName;

  const time = document.createElement("time");
  time.className = "transcript-time";
  time.textContent = formatTimestamp(entry.endedAt);

  const text = document.createElement("p");
  text.className = "transcript-text";
  text.textContent = entry.text;

  meta.append(speaker, time);
  item.append(meta, text);
  transcriptList.appendChild(item);
  transcriptList.scrollTop = transcriptList.scrollHeight;
}

async function loadTranscriptBacklog() {
  const response = await fetch(`/api/transcripts/${encodeURIComponent(roomId)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "Unable to load transcript history.");
  }

  transcriptList.replaceChildren();
  seenTranscriptSequences.clear();
  if (!data.entries.length) {
    ensureTranscriptPlaceholder();
    return;
  }

  for (const entry of data.entries) {
    appendTranscriptEntry(entry);
  }
}

function connectCaptionFeed() {
  if (!roomId) {
    return;
  }

  if (captionSocket) {
    captionSocket.close();
  }

  const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
  captionSocket = new WebSocket(
    `${wsScheme}://${window.location.host}/ws/transcripts/${encodeURIComponent(roomId)}`,
  );

  captionSocket.addEventListener("open", () => {
    setTranscriptStatus("Listening for live captions...");
  });

  captionSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "transcript") {
      appendTranscriptEntry(payload.entry);
      setTranscriptStatus("Live captions are active.");
    } else if (payload.type === "transcription-error") {
      setTranscriptStatus(payload.message, true);
    }
  });

  captionSocket.addEventListener("close", () => {
    captionSocket = null;
  });
}

async function startTrackTranscription(trackSid, participantIdentity, participantName) {
  const response = await fetch("/api/transcription/start-track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId,
      trackSid,
      participantIdentity,
      participantName,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Unable to start transcription.");
  }

  activeAudioTrackSid = trackSid;
  if (data.started) {
    setTranscriptStatus("Live captions are starting...");
  } else {
    setTranscriptStatus("Live captions are already active.");
  }
}

async function stopTrackTranscription() {
  if (!activeAudioTrackSid) {
    return;
  }

  try {
    await fetch("/api/transcription/stop-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId,
        trackSid: activeAudioTrackSid,
      }),
    });
  } catch (error) {
    // Leaving the room should not depend on the cleanup request succeeding.
  } finally {
    activeAudioTrackSid = null;
  }
}

function bindRoomEvents(room) {
  room
    .on(RoomEvent.ParticipantConnected, (participant) => {
      ensureParticipantCard(
        participant.identity,
        participantLabel(participant, false),
        false,
      );
      setStatus(`${participantLabel(participant)} joined the room.`);
    })
    .on(RoomEvent.ParticipantDisconnected, (participant) => {
      removeParticipantCard(participant.identity);
      setStatus(`${participantLabel(participant)} left the room.`);
    })
    .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      attachTrack(track, participant, false);
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      detachTrack(track);
    })
    .on(RoomEvent.Disconnected, () => {
      setStatus("You left the room.");
      videoGrid.replaceChildren();
      ensurePlaceholder();
      activeRoom = null;
      participantNameInput.disabled = false;
      leaveButton.disabled = true;
      joinButton.disabled = false;
      activeAudioTrackSid = null;
      if (captionSocket) {
        captionSocket.close();
        captionSocket = null;
      }
      transcriptList.replaceChildren();
      ensureTranscriptPlaceholder();
      setTranscriptStatus("Captions disconnected.");
    });
}

function renderExistingParticipants(room) {
  room.remoteParticipants.forEach((participant) => {
    ensureParticipantCard(
      participant.identity,
      participantLabel(participant, false),
      false,
    );
    participant.trackPublications.forEach((publication) => {
      if (publication.track) {
        attachTrack(publication.track, participant, false);
      }
    });
  });
}

async function publishLocalMedia(room, displayName) {
  localTracks = [];
  const createdTracks = await createLocalTracks({ audio: true, video: true });
  let audioTrackSid = null;

  for (const track of createdTracks) {
    const publication = await room.localParticipant.publishTrack(track);
    localTracks.push({ track, publication });
    attachTrack(
      track,
      {
        identity: room.localParticipant.identity,
        name: displayName,
      },
      true,
    );

    if (track.kind === "audio") {
      audioTrackSid = publication.trackSid || publication.sid || track.sid || null;
    }
  }

  return { audioTrackSid };
}

async function leaveRoom() {
  await stopTrackTranscription();

  for (const { track } of localTracks) {
    track.stop();
    detachTrack(track);
  }
  localTracks = [];

  if (captionSocket) {
    captionSocket.close();
    captionSocket = null;
  }

  if (activeRoom) {
    await activeRoom.disconnect();
  } else {
    videoGrid.replaceChildren();
    ensurePlaceholder();
    transcriptList.replaceChildren();
    ensureTranscriptPlaceholder();
  }
}

copyRoomLinkButton.addEventListener("click", async () => {
  try {
    await copyText(roomLinkInput.value);
    setStatus("Room URL copied.");
  } catch (error) {
    setStatus("Copy failed. You can copy the URL manually.", true);
  }
});

leaveButton.addEventListener("click", async () => {
  leaveButton.disabled = true;
  await leaveRoom();
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!roomId) {
    setStatus("This room link is invalid.", true);
    return;
  }

  const participantName = participantNameInput.value.trim();
  if (!participantName) {
    setStatus("Enter your name before joining.", true);
    participantNameInput.focus();
    return;
  }

  joinButton.disabled = true;
  transcriptList.replaceChildren();
  ensureTranscriptPlaceholder();
  seenTranscriptSequences.clear();
  setStatus("Joining room...");
  setTranscriptStatus("Preparing captions...");

  try {
    const tokenResponse = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId,
        participantName,
      }),
    });
    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(tokenData.detail || "Unable to join the room.");
    }

    activeRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    bindRoomEvents(activeRoom);
    await activeRoom.connect(tokenData.livekitUrl, tokenData.token);
    await loadTranscriptBacklog();
    connectCaptionFeed();

    const { audioTrackSid } = await publishLocalMedia(activeRoom, participantName);
    renderExistingParticipants(activeRoom);

    if (audioTrackSid) {
      await startTrackTranscription(
        audioTrackSid,
        activeRoom.localParticipant.identity,
        participantName,
      );
    } else {
      setTranscriptStatus("Audio track was not published, so captions are unavailable.", true);
    }

    participantNameInput.disabled = true;
    leaveButton.disabled = false;
    setStatus("Connected. Anyone with this link can join.");
  } catch (error) {
    if (activeRoom) {
      await activeRoom.disconnect();
      activeRoom = null;
    }
    setStatus(error.message || "Unable to join the room.", true);
    joinButton.disabled = false;
    leaveButton.disabled = true;
    setTranscriptStatus(error.message || "Captions are unavailable.", true);
  }
});

window.addEventListener("beforeunload", () => {
  if (activeRoom) {
    activeRoom.disconnect();
  }
});
