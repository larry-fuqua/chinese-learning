# syntax=docker/dockerfile:1
# CPU forced-alignment sidecar. The MMS_FA weights download into TORCH_HOME
# on first start (~1.2 GB). They are not copied into this image.
FROM python:3.12-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY align/server.py /app/server.py
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.5.1 torchaudio==2.5.1

ENV TORCH_HOME=/models
ENV ALIGN_PORT=8000
EXPOSE 8000

CMD ["python", "-u", "/app/server.py"]
