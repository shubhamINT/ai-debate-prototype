const reportTitle = document.querySelector("#report-title");
const reportSubtitle = document.querySelector("#report-subtitle");
const backToRoomLink = document.querySelector("#back-to-room-link");
const reportStatus = document.querySelector("#report-status");
const transcriptList = document.querySelector("#report-transcript-list");
const entryCount = document.querySelector("#entry-count");
const speakerCount = document.querySelector("#speaker-count");

const pathParts = window.location.pathname.split("/").filter(Boolean);
const roomId = pathParts.length >= 3 ? pathParts[1] : "";
const seenTranscriptSequences = new Set();
const speakers = new Set();

let captionSocket = null;

reportTitle.textContent = roomId ? `Room ${roomId}` : "Transcript Report";
reportSubtitle.textContent = roomId
  ? `Review saved and live transcription entries for room ${roomId}.`
  : "This report link is invalid.";
const backToRoomNav = document.querySelector("#back-to-room-nav");
const roomHref = roomId ? `/room/${encodeURIComponent(roomId)}` : "/";
backToRoomLink.href = roomHref;
if (backToRoomNav) backToRoomNav.href = roomHref;

function setStatus(message, isError = false) {
  reportStatus.textContent = message;
  reportStatus.classList.toggle("error", isError);
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

function clearTranscriptPlaceholder() {
  const placeholder = transcriptList.querySelector(".transcript-placeholder");
  if (placeholder) {
    placeholder.remove();
  }
}

function ensureTranscriptPlaceholder(message) {
  if (transcriptList.children.length > 0) {
    return;
  }

  const placeholder = document.createElement("article");
  placeholder.className = "transcript-placeholder";
  placeholder.textContent = message;
  transcriptList.appendChild(placeholder);
}

function updateSummary() {
  entryCount.textContent = String(seenTranscriptSequences.size);
  speakerCount.textContent = String(speakers.size);
}

function appendTranscriptEntry(entry) {
  if (!entry || seenTranscriptSequences.has(entry.sequence)) {
    return;
  }

  seenTranscriptSequences.add(entry.sequence);
  if (entry.participantName) {
    speakers.add(entry.participantName);
  }
  clearTranscriptPlaceholder();

  const item = document.createElement("article");
  item.className = "transcript-entry";
  item.dataset.sequence = String(entry.sequence);

  const meta = document.createElement("div");
  meta.className = "transcript-entry-meta";

  const speaker = document.createElement("span");
  speaker.className = "transcript-speaker";
  speaker.textContent = entry.participantName || "Unknown speaker";

  const time = document.createElement("time");
  time.className = "transcript-time";
  time.textContent = formatTimestamp(entry.endedAt);

  const text = document.createElement("p");
  text.className = "transcript-text";
  text.textContent = entry.text;

  meta.append(speaker, time);
  item.append(meta, text);
  transcriptList.appendChild(item);
  updateSummary();
}

async function loadTranscriptBacklog() {
  const response = await fetch(`/api/transcripts/${encodeURIComponent(roomId)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "Unable to load transcript history.");
  }

  transcriptList.replaceChildren();
  seenTranscriptSequences.clear();
  speakers.clear();

  if (!data.entries.length) {
    ensureTranscriptPlaceholder("No transcript entries have been saved for this room yet.");
    updateSummary();
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

  const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
  captionSocket = new WebSocket(
    `${wsScheme}://${window.location.host}/ws/transcripts/${encodeURIComponent(roomId)}`,
  );

  captionSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "transcript") {
      appendTranscriptEntry(payload.entry);
      setStatus("Live transcript updates are active.");
    } else if (payload.type === "transcription-error") {
      setStatus(payload.message, true);
    }
  });

  captionSocket.addEventListener("close", () => {
    captionSocket = null;
  });
}

async function initializeReport() {
  if (!roomId) {
    setStatus("This report link is invalid.", true);
    transcriptList.replaceChildren();
    ensureTranscriptPlaceholder("A valid room report URL is required.");
    updateSummary();
    return;
  }

  try {
    await loadTranscriptBacklog();
    connectCaptionFeed();
    setStatus("Transcript history loaded.");
  } catch (error) {
    setStatus(error.message || "Unable to load transcript history.", true);
    transcriptList.replaceChildren();
    ensureTranscriptPlaceholder("Transcript history could not be loaded.");
    updateSummary();
  }
}

window.addEventListener("beforeunload", () => {
  if (captionSocket) {
    captionSocket.close();
  }
});

initializeReport();
