FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install system CLI tools
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    curl \
    file \
    findutils \
    ffmpeg \
    git \
    grep \
    jq \
    less \
    procps \
    python3 \
    python3-pip \
    python3-pillow \
    ripgrep \
    sed \
    tar \
    unzip \
    util-linux \
    libreoffice-writer-nogui \
    libreoffice-calc-nogui \
    libreoffice-impress-nogui \
    pandoc \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# Install Python Libraries for Office Automation, Data Science, and Utilities
RUN pip3 install --no-cache-dir --break-system-packages \
    # Office & Document Processing
    python-docx \
    openpyxl \
    python-pptx \
    pypdf \
    csvkit \
    # Core Data Science & Visualization
    pandas \
    numpy \
    scipy \
    matplotlib \
    seaborn \
    # Networking & API Interaction
    requests \
    httpx \
    # Utility & Quality of Life
    tqdm \
    python-dateutil \
    pytz

WORKDIR /workspace

CMD ["sleep", "365d"]