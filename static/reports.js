const statusEl = document.querySelector("#reports-status");
const roomsList = document.querySelector("#rooms-list");

const dummyRooms = [
  {
    roomId: "demo-debate-room",
    entryCount: 6,
    speakerCount: 3,
    lastActivity: "2026-04-10T10:02:44Z",
  },
];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderRooms(rooms) {
  roomsList.replaceChildren();

  for (const room of rooms) {
    const card = document.createElement("article");
    card.className = "room-card";

    card.innerHTML = `
      <div class="room-card-info">
        <div class="room-card-id">${room.roomId}</div>
        <div class="room-card-meta">
          <span class="room-card-stat"><strong>${room.entryCount}</strong> entries</span>
          <span class="room-card-sep">·</span>
          <span class="room-card-stat"><strong>${room.speakerCount}</strong> speaker${room.speakerCount === 1 ? "" : "s"}</span>
          <span class="room-card-sep">·</span>
          <span class="room-card-date">${formatDate(room.lastActivity)}</span>
        </div>
      </div>
      <div class="room-card-actions">
        <a class="secondary" href="/room/${encodeURIComponent(room.roomId)}/report">View Transcript</a>
        <a class="primary" href="/room/${encodeURIComponent(room.roomId)}">Join Room</a>
      </div>
    `;

    roomsList.appendChild(card);
  }
}

async function loadRooms() {
  try {
    const res = await fetch("/api/transcripts");
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Failed to load sessions.");
    }

    if (Array.isArray(data.rooms) && data.rooms.length) {
      renderRooms(data.rooms);
      setStatus(`${data.rooms.length} session${data.rooms.length === 1 ? "" : "s"} found.`);
      return;
    }
  } catch (_error) {
    // Fall back to static demo data for now.
  }

  renderRooms(dummyRooms);
  setStatus("Showing a dummy transcript session for now.");
}

loadRooms();
