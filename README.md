# CensorGPT-Extension

CensorGPT-Extension is a privacy-focused Chrome extension paired with a lightweight FastAPI backend. Its goal is to **alert users when their prompts contain Personally Identifiable Information (PII)** before sending them to Generative AI systems like ChatGPT. This prevents unintentional leakage of sensitive data to cloud-hosted LLM providers, while leaving the final decision in the user’s hands.

---

## 📌 Problem Statement

Generative AI systems are increasingly powerful but raise significant **privacy risks**:

- Prompts may contain sensitive PII (names, addresses, phone numbers, IDs).
- Cloud-based LLMs (MLaaS) can inadvertently store or leak this data.

**CensorGPT-Extension** tackles this problem by:

1. Intercepting user input in the browser.
2. Sending it to a local backend for PII detection.
3. Alerting the user if PII is found — so they can decide whether to continue.

---

## ⚙️ Features & Functionality

- **Chrome Extension Integration**

  - Content script intercepts user input.
  - Background script manages messaging and extension logic.
  - Popup UI shows detected PII before sending.
  - Options page for configurable settings.

- **Backend Detection (app.py)**

  - Built with **FastAPI** and served via **Uvicorn**.
  - Runs **gemma3:4b** (via Ollama + LangChain) to detect PII.
  - Returns detection results to the extension in real time.
  - Logs ingested prompts for testing (`ingested_prompts.log`).

- **Privacy First**
  - Detects common PII patterns (emails, phone numbers, IDs, credit card numbers).
  - Alerts instead of censoring — user maintains full control.
  - No storage of sensitive data beyond temporary logs for testing.

---

## 🛠 Development Tools Used

- **Frontend / Extension:**

  - JavaScript (background/content scripts, popup, options)
  - HTML, CSS

- **Backend:**

  - Python 3
  - FastAPI + Uvicorn (REST API server)
  - Ollama with gemma3:4b model for PII detection

- **Other Tools:**
  - Chrome Extensions API
  - LangChain for LLM orchestration

---

## 🔌 Python Libraries

From `requirements.txt`:

- **FastAPI** (0.116.1) – Web framework
- **Uvicorn** (0.35.0) – ASGI server
- **LangChain-Core** (0.3.75) – LLM orchestration
- **LangChain-Ollama** (0.3.7) – Ollama integration
- **Ollama** (0.5.3) – Local model runtime (gemma3:4b)
- **Requests / HTTPX** – HTTP client libraries
- **Pydantic** (2.11.7) – Data validation
- **Orjson** (3.11.3) – Fast JSON handling
- **Tenacity** (9.1.2) – Retry logic
- Plus supporting libraries: `anyio`, `starlette`, `PyYAML`, `typing-extensions`, etc.

---

## 📂 Project Structure

```
censorGPT-Extension/
│── app.py                # FastAPI backend for PII detection
│── requirements.txt      # Python dependencies
│── extend/               # Chrome extension source
│   ├── manifest.json     # Extension manifest
│   ├── background.js     # Background script
│   ├── content.js        # Intercepts input
│   ├── popup.html/js     # Popup UI
│   ├── options.html/js   # Options page
│   ├── styles.css        # Styling
│   └── ingested_prompts.log # Example log of prompts
│── README.md             # Project documentation
│── LICENSE
```

---

## 🚀 Installation

### 1. Backend Setup

```bash
# Clone the repository
git clone https://github.com/keananhong/censorGPT-Extension.git
cd censorGPT-Extension

# Install Python dependencies
pip install -r requirements.txt
```

### 2. Chrome Extension Setup

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extend/` folder.
4. The extension will appear in your toolbar.

### 3. Local Model Installation

1. Download and install Ollama from https://www.ollama.com
2. In Ollama, install the gemma3:4b model by selecting it and sending it a prompt.
```bash
# Download gemma3:4b model
ollama pull gemma3:4b
```

### 4. Run the extension!
```bash
# Go to the downloaded repository
cd censorGPT-Extension

# Run the program
python3 app.py

```

---

## 📹 Demonstration Video

A 3-minute demo video shows:

- The extension detecting PII in real-time.
- Popup alerting the user before sending.
- User decision whether to proceed with the prompt.

📺 [YouTube Demo Link – To be added]

---

## 📜 License

This project is licensed under the terms of the repository’s [LICENSE](LICENSE).

---

👉 [GitHub Repo Link](https://github.com/keananhong/censorGPT-Extension/tree/main)
