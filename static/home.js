const createRoomButton = document.querySelector("#create-room-button");
const createStatus = document.querySelector("#create-status");
const sharePanel = document.querySelector("#share-panel");
const shareLink = document.querySelector("#share-link");
const copyLinkButton = document.querySelector("#copy-link-button");
const joinCreatedRoom = document.querySelector("#join-created-room");

function setStatus(message, isError = false) {
  createStatus.textContent = message;
  createStatus.classList.toggle("error", isError);
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
}

createRoomButton.addEventListener("click", async () => {
  createRoomButton.disabled = true;
  setStatus("Creating a room link...");

  try {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Unable to create room.");
    }

    shareLink.value = data.joinUrl;
    joinCreatedRoom.href = data.joinUrl;
    sharePanel.classList.remove("hidden");
    joinCreatedRoom.classList.remove("hidden");
    setStatus("Room created. Share the link or open the room now.");
  } catch (error) {
    setStatus(error.message || "Unable to create room.", true);
  } finally {
    createRoomButton.disabled = false;
  }
});

copyLinkButton.addEventListener("click", async () => {
  if (!shareLink.value) {
    return;
  }

  try {
    await copyText(shareLink.value);
    setStatus("Room link copied.");
  } catch (error) {
    setStatus("Copy failed. You can copy the link manually.", true);
  }
});
