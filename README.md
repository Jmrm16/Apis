# Fastify Media Scraping & Extraction API

A high-performance asynchronous API built with **TypeScript**, **Fastify**, and **Playwright** for automated media content extraction, image processing, and PDF aggregation.

---

## 🚀 Features

- **High-Speed Routing:** Powered by [Fastify v5](https://fastify.dev/) for minimal overhead and low-latency JSON responses.
- **Headless Browser Automation:** Uses Playwright to extract dynamic DOM elements and handle anti-bot rendering.
- **Image Processing & PDF Compilation:** Utilizes `sharp` and `pdf-lib` for high-throughput image optimization and document rendering.
- **Type Safety:** Full TypeScript setup with strict configurations.

---

## 🛠️ Tech Stack

- **Runtime:** Node.js (>=20)
- **Framework:** Fastify v5
- **Language:** TypeScript
- **Automation:** Playwright Core
- **Media Processing:** Sharp, PDF-Lib

---

## 📦 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/Jmrm16/Apis.git
cd Apis
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 4. Run in Development Mode
```bash
npm run dev
```

### 5. Build for Production
```bash
npm run build
npm start
```
