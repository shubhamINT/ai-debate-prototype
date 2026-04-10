const reportTitle = document.querySelector("#report-title");
const reportSubtitle = document.querySelector("#report-subtitle");
const reportStatus = document.querySelector("#report-status");
const transcriptList = document.querySelector("#report-transcript-list");
const entryCount = document.querySelector("#entry-count");
const speakerCount = document.querySelector("#speaker-count");
const generateReportButton = document.querySelector("#generate-report-button");

const pathParts = window.location.pathname.split("/").filter(Boolean);
const roomId = pathParts.length >= 3 ? pathParts[1] : "";

const transcriptEntries = [
  {
    sequence: 1,
    participantName: "Aisha",
    endedAt: "2026-04-10T10:00:12Z",
    text: "I think AI debate platforms should prioritize factual grounding before speed so the conversation stays useful for everyone.",
  },
  {
    sequence: 2,
    participantName: "Rohan",
    endedAt: "2026-04-10T10:00:35Z",
    text: "Speed still matters because if the system takes too long to respond, people stop engaging and the debate loses momentum.",
  },
  {
    sequence: 3,
    participantName: "Meera",
    endedAt: "2026-04-10T10:01:04Z",
    text: "A balanced approach would be fast responses with confidence checks so low-confidence claims can be flagged for review.",
  },
  {
    sequence: 4,
    participantName: "Aisha",
    endedAt: "2026-04-10T10:01:36Z",
    text: "That works if the flags are visible enough, otherwise users may treat uncertain statements as confirmed facts.",
  },
  {
    sequence: 5,
    participantName: "Rohan",
    endedAt: "2026-04-10T10:02:10Z",
    text: "We could also score each speaker on clarity and evidence so the audience gets a quick sense of debate quality.",
  },
  {
    sequence: 6,
    participantName: "Meera",
    endedAt: "2026-04-10T10:02:44Z",
    text: "That would make the session more actionable because the final report could summarize strong points, weak points, and speaker performance.",
  },
];

const generatedReport = {
  overview:
    "The discussion stayed focused on how an AI debate product should balance response speed, factual reliability, and visible quality signals. The group aligned around a hybrid approach where the system stays responsive but marks uncertainty and produces a post-call evaluation.",
  highlights: [
    "Aisha consistently pushed for factual grounding and better visibility for uncertain claims.",
    "Rohan argued for fast interaction and suggested user-facing quality scoring to keep debates engaging.",
    "Meera connected both positions and proposed a practical report flow with strengths, weaknesses, and outcome signals.",
  ],
  ratings: [
    {
      participantName: "Aisha",
      rating: "9.1/10",
      rationale: "Strong on accuracy, risk awareness, and keeping the conversation grounded.",
    },
    {
      participantName: "Rohan",
      rating: "8.6/10",
      rationale: "Good energy and product thinking, with clear focus on engagement and usability.",
    },
    {
      participantName: "Meera",
      rating: "9.3/10",
      rationale: "Best balance across both sides and the clearest path to an implementable solution.",
    },
  ],
};

reportTitle.textContent = roomId ? `Room ${roomId}` : "Transcript Report";
reportSubtitle.textContent = roomId
  ? `Review the transcription and generate a report for room ${roomId}.`
  : "This report link is invalid.";

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

function updateSummary(entries) {
  const speakers = new Set(entries.map((entry) => entry.participantName).filter(Boolean));
  entryCount.textContent = String(entries.length);
  speakerCount.textContent = String(speakers.size);
}

const SPEAKER_COLORS = [
  "#c8102e",
  "#1d4ed8",
  "#047857",
  "#6d28d9",
  "#b45309",
  "#0f766e",
  "#be185d",
  "#1e40af",
];

function getSpeakerColor(speakerMap, name) {
  if (!speakerMap.has(name)) {
    speakerMap.set(name, SPEAKER_COLORS[speakerMap.size % SPEAKER_COLORS.length]);
  }
  return speakerMap.get(name);
}

function getInitials(name) {
  return (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function renderTranscriptEntries(entries) {
  transcriptList.replaceChildren();

  if (!entries.length) {
    const placeholder = document.createElement("article");
    placeholder.className = "transcript-placeholder";
    placeholder.textContent = "No transcript entries available.";
    transcriptList.appendChild(placeholder);
    updateSummary([]);
    return;
  }

  const speakerColors = new Map();
  let lastSpeaker = null;

  for (const entry of entries) {
    const name = entry.participantName || "Unknown";
    const color = getSpeakerColor(speakerColors, name);
    const isContinued = name === lastSpeaker;
    lastSpeaker = name;

    const row = document.createElement("article");
    row.className = "conv-row" + (isContinued ? " conv-continued" : "");
    row.dataset.sequence = String(entry.sequence);

    if (!isContinued) {
      const avatar = document.createElement("div");
      avatar.className = "conv-avatar";
      avatar.style.background = color;
      avatar.textContent = getInitials(name);

      const body = document.createElement("div");
      body.className = "conv-body";

      const header = document.createElement("div");
      header.className = "conv-header";

      const speakerEl = document.createElement("span");
      speakerEl.className = "conv-speaker";
      speakerEl.style.color = color;
      speakerEl.textContent = name;

      const timeEl = document.createElement("time");
      timeEl.className = "conv-time";
      timeEl.textContent = formatTimestamp(entry.endedAt);

      const textEl = document.createElement("p");
      textEl.className = "conv-text";
      textEl.textContent = entry.text;

      header.append(speakerEl, timeEl);
      body.append(header, textEl);
      row.append(avatar, body);
    } else {
      const spacer = document.createElement("div");
      spacer.className = "conv-avatar-spacer";

      const textEl = document.createElement("p");
      textEl.className = "conv-text conv-text--continued";
      textEl.textContent = entry.text;

      const timeEl = document.createElement("time");
      timeEl.className = "conv-time conv-time--inline";
      timeEl.textContent = formatTimestamp(entry.endedAt);
      textEl.appendChild(timeEl);

      row.append(spacer, textEl);
    }

    transcriptList.appendChild(row);
  }

  updateSummary(entries);
}


function renderGeneratedReport() {
  localStorage.setItem(
    `generated-report-${roomId}`,
    JSON.stringify({ roomId, report: generatedReport })
  );
  window.location.href = `/room/${encodeURIComponent(roomId)}/generated-report`;
}

function initializeReport() {
  if (!roomId) {
    setStatus("This report link is invalid.", true);
    transcriptList.replaceChildren();

    const placeholder = document.createElement("article");
    placeholder.className = "transcript-placeholder";
    placeholder.textContent = "A valid room report URL is required.";
    transcriptList.appendChild(placeholder);
    updateSummary([]);
    if (generateReportButton) {
      generateReportButton.disabled = true;
    }
    return;
  }

  renderTranscriptEntries(transcriptEntries);
  setStatus("Transcription loaded.");
}

if (generateReportButton) {
  generateReportButton.addEventListener("click", () => {
    renderGeneratedReport();
  });
}

initializeReport();
