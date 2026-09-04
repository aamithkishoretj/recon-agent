"""
Runs the AI reasoning layer over exceptions already produced by run_pipeline.py.

Usage:
    python3 run_ai_reasoning.py

If GEMINI_API_KEY is not set as an environment variable, this runs in MOCK
MODE automatically — safe to test the wiring with zero cost, but it always
declines (the safe behavior for unexplained amount and ambiguous-candidate
cases, but it means you won't see a model response until a real key is set).
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models.db import get_engine, get_session_factory
from app.services.ai_reasoning import apply_ai_reasoning


def main():
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    db_path = f"{backend_dir}/data/recon.db"
    if not os.path.exists(db_path):
        print("No DB found — run run_pipeline.py first.")
        return

    engine = get_engine(f"sqlite:///{db_path}")
    Session = get_session_factory(engine)
    s = Session()

    mode = "LIVE (calling Gemini)" if os.environ.get("GEMINI_API_KEY") else "MOCK (no GEMINI_API_KEY set)"
    print(f"Mode: {mode}\n")

    processed, total, by_category = apply_ai_reasoning(s)
    print(f"Processed {total} supported exceptions:")
    print(f"  Amount discrepancies: {by_category.get('amount_discrepancy', 0)}")
    print(f"  Ambiguous candidates: {by_category.get('ambiguous_candidate', 0)}")
    print(f"  AI proposed a resolution: {processed['resolved_hypothesis']}")
    print(f"  AI declined (insufficient evidence): {processed['declined_hypothesis']}")
    print("\nAll of these are now status=IN_REVIEW — no Match was auto-created.")
    print("A human must approve/reject each via the review queue (Phase 5) before")
    print("it can become an actual Match.")


if __name__ == "__main__":
    main()
