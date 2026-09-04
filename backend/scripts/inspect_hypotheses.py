import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models.db import get_engine, get_session_factory, Exception_, ExceptionCategory

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
engine = get_engine(f"sqlite:///{backend_dir}/data/recon.db")
Session = get_session_factory(engine)
s = Session()

exc = s.query(Exception_).filter_by(category=ExceptionCategory.AMOUNT_DISCREPANCY).limit(3).all()
for e in exc:
    print("---")
    print("Confidence:", e.ai_hypothesis["confidence"])
    print("Explanation:", e.ai_hypothesis["explanation"])
