const statusEl = document.querySelector("#reports-status");
const roomsList = document.querySelector("#rooms-list");

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

  if (!rooms.length) {
    const empty = document.createElement("article");
    empty.className = "transcript-placeholder";
    empty.textContent = "No debate sessions recorded yet. Create a room and start talking!";
    roomsList.appendChild(empty);
    setStatus("");
    return;
  }

  setStatus(`${rooms.length} session${rooms.length === 1 ? "" : "s"} found.`);

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
    if (!res.ok) throw new Error(data.detail || "Failed to load sessions.");
    renderRooms(data.rooms);
  } catch (err) {
    setStatus(err.message || "Unable to load sessions.", true);
  }
}

loadRooms();
