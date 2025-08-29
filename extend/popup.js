const input = document.getElementById("url");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["API_URL"], ({ API_URL }) => {
  input.value = API_URL || "http://127.0.0.1:8000/check";
});

document.getElementById("save").onclick = () => {
  const url = input.value.trim();
  chrome.runtime.sendMessage({ type: "SET_API_URL", url }, (resp) => {
    if (resp?.ok) {
      statusEl.textContent = "Saved.";
      setTimeout(()=> statusEl.textContent = "", 1500);
    } else {
      statusEl.textContent = "Failed to save.";
    }
  });
};
