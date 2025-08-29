from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ---- NEW: LLM-based PII extractor (Ollama via LangChain) ----
# Requirements:
#   - pip install langchain-ollama fastapi uvicorn
#   - Ollama running locally: https://ollama.com/
#   - Pull the model once:   ollama pull gemma3:4b
from langchain_ollama import ChatOllama

# Initialize once at startup. If this fails, ensure Ollama is running and the model exists.
try:
    llm = ChatOllama(model="gemma3:4b", validate_model_on_init=True)
except Exception as e:
    # We don't crash the process at import; /check will raise a clear error instead.
    llm = None
    _llm_init_error = e

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this in production
    allow_methods=["*"],
    allow_headers=["*"],
)

class Payload(BaseModel):
    text: str

# --- Helper: call the LLM to extract PII and parse its response ---
PII_SYSTEM_PROMPT = (
    "PII (Personally Identifiable Information) is data that can be used to identify a "
    "specific individual, specifically, any information that should be kept private, "
    "such as their home address, credit card number, identification numbers, etc. "
    "You are required to extract as many PIIs as possible in the following message, "
    "and return an output in the following format:\n"
    "{Type of PII}: {Extracted data}\n"
    "ONLY RETURN LINES IN THE FORMAT {Type of PII}: {Extracted data}"
)

def detect_sensitive_words_via_llm(text: str):
    """
    Calls the local Ollama model (via LangChain) to extract PII.
    Returns a list of dicts: [{"type": "...", "value": "..."}, ...]
    """
    if llm is None:
        # Model didn't initialize; surface the startup error clearly
        raise HTTPException(status_code=503, detail=f"LLM not available: {_llm_init_error}")

    # Build a chat-style message list (system + human) for ChatOllama
    messages = [
        ("system", PII_SYSTEM_PROMPT),
        ("human", text or "")
    ]

    try:
        # Simple, blocking call (you can switch to .stream for tokens if desired)
        resp = llm.invoke(messages)
        raw = getattr(resp, "content", None)
        if raw is None:
            # Some LangChain wrappers may return plain text
            raw = str(resp)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {e}")

    # Parse lines like: "Type: value"
    results = []
    for line in (raw or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if ":" in line:
            t, v = line.split(":", 1)
            t, v = t.strip(), v.strip()
            if t and v:
                results.append({"type": t, "value": v})
        else:
            # If the model deviates from the requested format, capture the raw line
            results.append({"type": "PII", "value": line})
    return results

@app.post("/check")
def check(payload: Payload):
    """
    Replaces the previous regex-based detector with an LLM-driven extractor.

    """
    items = detect_sensitive_words_via_llm(payload.text or "")
    # For backward compatibility with former "sensitive_words" key,
    # we include both a structured and a flat representation.
    flat = [f'{it["type"]}: {it["value"]}' for it in items]
    print(flat)
    return {"sensitive": items, "sensitive_words": flat}

# -------- Existing /ingest stays the same --------
class IngestPayload(BaseModel):
    text: str

@app.post("/ingest")
def ingest(payload: IngestPayload):
    msg = (payload.text or "").strip()
    print(f"[INGEST] {msg}")
    try:    
        with open("ingested_prompts.log", "a", encoding="utf-8") as fp:
            fp.write(msg + "\n")
    except Exception:
        pass

    # Run PII detection here
    try:
        pii_items = detect_sensitive_words_via_llm(msg)
    except Exception as e:
        pii_items = [{"type": "error", "value": str(e)}]

    print(pii_items)
    return {"ok": True, "received": msg, "pii": pii_items}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
