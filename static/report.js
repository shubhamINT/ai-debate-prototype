const reportTitle = document.querySelector("#report-title");
const reportSubtitle = document.querySelector("#report-subtitle");
const backToRoomLink = document.querySelector("#back-to-room-link");
const reportStatus = document.querySelector("#report-status");
const transcriptList = document.querySelector("#report-transcript-list");
const entryCount = document.querySelector("#entry-count");
const speakerCount = document.querySelector("#speaker-count");
const generateReportButton = document.querySelector("#generate-report-button");
const generatedReportPanel = document.querySelector("#generated-report-panel");
const reportOverview = document.querySelector("#report-overview");
const reportHighlights = document.querySelector("#report-highlights");
const participantRatings = document.querySelector("#participant-ratings");

const pathParts = window.location.pathname.split("/").filter(Boolean);
const roomId = pathParts.length >= 3 ? pathParts[1] : "";

const dummyTranscriptEntries = [
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

const dummyGeneratedReport = {
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
  ? `Review the dummy multi-user transcription and generate a sample report for room ${roomId}.`
  : "This report link is invalid.";

const backToRoomNav = document.querySelector("#back-to-room-nav");
const roomHref = roomId ? `/room/${encodeURIComponent(roomId)}` : "/";
backToRoomLink.href = roomHref;
if (backToRoomNav) {
  backToRoomNav.href = roomHref;
}

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

  for (const entry of entries) {
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
  }

  updateSummary(entries);
}

function renderHighlights(highlights) {
  reportHighlights.replaceChildren();

  for (const highlight of highlights) {
    const point = document.createElement("article");
    point.className = "generated-point";
    point.textContent = highlight;
    reportHighlights.appendChild(point);
  }
}

function renderRatings(ratings) {
  participantRatings.replaceChildren();

  for (const rating of ratings) {
    const card = document.createElement("article");
    card.className = "rating-card";

    const meta = document.createElement("div");
    meta.className = "rating-card-meta";

    const name = document.createElement("strong");
    name.className = "rating-card-name";
    name.textContent = rating.participantName;

    const value = document.createElement("span");
    value.className = "rating-card-score";
    value.textContent = rating.rating;

    const text = document.createElement("p");
    text.className = "rating-card-copy";
    text.textContent = rating.rationale;

    meta.append(name, value);
    card.append(meta, text);
    participantRatings.appendChild(card);
  }
}

function renderGeneratedReport() {
  reportOverview.textContent = dummyGeneratedReport.overview;
  renderHighlights(dummyGeneratedReport.highlights);
  renderRatings(dummyGeneratedReport.ratings);
  generatedReportPanel.classList.remove("hidden");
  setStatus("Dummy report generated successfully.");
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

  renderTranscriptEntries(dummyTranscriptEntries);
  setStatus("Dummy multi-user transcription loaded.");
}

if (generateReportButton) {
  generateReportButton.addEventListener("click", () => {
    renderGeneratedReport();
  });
}

initializeReport();
