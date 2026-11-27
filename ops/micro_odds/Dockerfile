FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY mrt/__init__.py mrt/odds.py ./mrt/
COPY two_t/kdreams_results.py two_t/source.py ./two_t/
COPY ops/micro_odds/runtime.py ./runtime.py
CMD ["python", "runtime.py"]
