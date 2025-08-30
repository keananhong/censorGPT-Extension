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
    """You are an information-extraction engine. You must produce one of exactly two outputs:

A) One or more lines, each in the exact format:
{Type of PII}: {Extracted Data}

B) A single line containing only:
NIL

Hard constraints:
- Output ONLY either (A) or (B). No prose, no markdown, no code fences, no labels, no blank lines.
- If ANY PII is present, use (A). If NO PII is present, use (B).
- When using (A), output one line per distinct PII value found; keep the first occurrence order; do not deduplicate across different types.
- {Extracted Data} must be the exact substring(s) from input (verbatim), trimmed of surrounding spaces and trailing punctuation. Do not normalize, expand, mask, reformat, or invent.
- If uncertain, DO NOT GUESS. Omit the item; choose NIL if no certain PII remains.

Definition of PII (non-exhaustive):
Data that can identify a specific individual. Examples include: personal names; usernames; email addresses; phone numbers; home or mailing addresses; government IDs (e.g., NRIC/SSN/SIN, passport numbers, driver’s license numbers); dates of birth; bank account numbers; credit/debit card numbers; license plates; IP addresses; MAC addresses; precise geolocation coordinates; social media handles tied to a person; biometric identifiers. Public company info alone is NOT PII unless it identifies a private individual.

Allowed labels for {Type of PII} (use EXACT spelling/casing):
Name
Username
Email
Phone Number
Home Address
Mailing Address
Date of Birth
National ID Number
Passport Number
Driver’s License Number
Credit Card Number
Bank Account Number
License Plate
IP Address
MAC Address
Geolocation Coordinates
Social Media Handle
Other PII

Additional rules:
- Split multi-item strings into separate lines (e.g., “John <john@x.com> +1-555-1234” → three lines).
- If you see PII embedded in a URL or text, extract only the PII substring and label it appropriately.
- If a value repeats for the same type, output it once (first occurrence position). If the same value appears under different types (rare), keep both lines.
- Do not output explanations, headers, bullet points, JSON, or anything else."""
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
        ("human", f"""Extract PII from the following input. Follow the system rules exactly.

INPUT:
{text}""" or "")
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
    if raw == "NIL":
        return None
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

# -------- Existing /ingest stays the same --------
class IngestPayload(BaseModel):
    text: str

@app.post("/ingest")
def ingest(payload: IngestPayload):
    msg = (payload.text or "").strip()
    print(f"Received: {msg}")

    try:
        pii_items = detect_sensitive_words_via_llm(msg)
    except Exception as e:
        pii_items = [{"type": "error", "value": str(e)}]

    print(f"LLM: {pii_items}")

    if pii_items:
        if {"type": "PII", "value": "NIL"} in pii_items:
            return {"ok": True, "received": msg, "pii": "null"}
        return {"ok": True, "received": msg, "pii": pii_items}
    else:
        return {"ok": True, "received": msg, "pii": "null"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
