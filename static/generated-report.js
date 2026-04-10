const reportTitle = document.querySelector("#report-title");
const reportSubtitle = document.querySelector("#report-subtitle");
const reportStatus = document.querySelector("#report-status");
const reportOverview = document.querySelector("#report-overview");
const reportHighlights = document.querySelector("#report-highlights");
const participantRatings = document.querySelector("#participant-ratings");
const backToTranscriptLink = document.querySelector("#back-to-transcript-link");
const backToTranscriptNav = document.querySelector("#back-to-transcript-nav");
const storeReportButton = document.querySelector("#store-report-button");

const pathParts = window.location.pathname.split("/").filter(Boolean);
const roomId = pathParts.length >= 3 ? pathParts[1] : "";

const transcriptHref = roomId ? `/room/${encodeURIComponent(roomId)}/report` : "/reports";
if (backToTranscriptLink) backToTranscriptLink.href = transcriptHref;
if (backToTranscriptNav) backToTranscriptNav.href = transcriptHref;

reportTitle.textContent = roomId ? `Report — Room ${roomId}` : "Debate Report";

function setStatus(message, isError = false) {
  reportStatus.textContent = message;
  reportStatus.classList.toggle("error", isError);
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

function loadReport() {
  if (!roomId) {
    setStatus("Invalid report URL.", true);
    return;
  }

  const stored = localStorage.getItem(`generated-report-${roomId}`);
  if (!stored) {
    setStatus("No report found. Go back to the transcript and click Generate Report.", true);
    reportSubtitle.textContent = "No data available for this report.";
    return;
  }

  const { report } = JSON.parse(stored);
  reportOverview.textContent = report.overview;
  renderHighlights(report.highlights);
  renderRatings(report.ratings);
  setStatus("");
}

storeReportButton.addEventListener("click", () => {
  // Placeholder — will save to backend in a future update
});

loadReport();
