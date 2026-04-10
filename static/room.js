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

const roomId = window.location.pathname.split("/").filter(Boolean).at(-1);
let activeRoom = null;
let localTracks = [];

roomTitle.textContent = roomId ? `Room ${roomId}` : "Invalid Room";
roomLinkInput.value = window.location.href;

function setStatus(message, isError = false) {
  roomStatus.textContent = message;
  roomStatus.classList.toggle("error", isError);
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
  localTracks = await createLocalTracks({ audio: true, video: true });

  for (const track of localTracks) {
    await room.localParticipant.publishTrack(track);
    attachTrack(
      track,
      {
        identity: room.localParticipant.identity,
        name: displayName,
      },
      true,
    );
  }
}

async function leaveRoom() {
  for (const track of localTracks) {
    track.stop();
    detachTrack(track);
  }
  localTracks = [];

  if (activeRoom) {
    await activeRoom.disconnect();
  } else {
    videoGrid.replaceChildren();
    ensurePlaceholder();
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
  setStatus("Joining room...");

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
    await publishLocalMedia(activeRoom, participantName);
    renderExistingParticipants(activeRoom);

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
  }
});

window.addEventListener("beforeunload", () => {
  if (activeRoom) {
    activeRoom.disconnect();
  }
});
