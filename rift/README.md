Pralhad Deshpande, [20-02-2026 09:11 AM]
# PharmaGuard - Pharmacogenomic Risk Prediction System

<div align="center">
  
  [![Live Demo](https://riftt.vercel.app/)]
  [![GitHub Repo](https://github.com/shivam-vishwakarmaa/riftt)]
  [![RIFT 2026](https://img.shields.io/badge/RIFT-2026-ff6b6b?style=for-the-badge)](https://rift2026.dev)
  
  🏆 RIFT 2026 Hackathon - Pharmacogenomics / Explainable AI Track
  
  [🎥 Watch Demo Video](https://drive.google.com/file/d/1BZsVQW-aUkmaytKHzS1qh5ew9EAMHYm2/view?usp=drivesdk) • [📄 Problem Statement](./PS1_PharmaGuard_HealthTech.pdf) • [🚀 Deployment](#deployment)
  
</div>

---

## 📋 Table of Contents
- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Installation](#-installation)
- [API Documentation](#-api-documentation)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Team](#-team)

---

## 🎯 Overview

PharmaGuard is an AI-powered clinical decision support system that predicts pharmacogenomic risks by analyzing patient genetic data (VCF files) and drug interactions. The system provides evidence-based recommendations aligned with CPIC (Clinical Pharmacogenetics Implementation Consortium) guidelines.

### The Problem
Adverse drug reactions kill over 100,000 Americans annually. Many of these deaths are preventable through pharmacogenomic testing — analyzing how genetic variants affect drug metabolism.

### Our Solution
- Parses authentic VCF files (v4.2, up to 5MB)
- Identifies variants across 6 critical genes: CYP2D6, CYP2C19, CYP2C9, SLCO1B1, TPMT, DPYD
- Predicts drug-specific risks: Safe, Adjust Dosage, Toxic, Ineffective, Unknown
- Generates LLM-powered explanations with CPIC citations
- Provides downloadable clinical PDF reports

---

## ✨ Features

### 🧬 Core Functionality
| Feature | Description |
|---------|-------------|
| VCF Parsing | Pure Python parser for v4.2 files up to 5MB |
| 6 Key Genes | CYP2D6, CYP2C19, CYP2C9, SLCO1B1, TPMT, DPYD |
| Supported Drugs | Codeine, Warfarin, Clopidogrel, Simvastatin, Azathioprine, Fluorouracil, Fluoxetine, Paroxetine, Ibuprofen, Omeprazole |
| Risk Labels | Safe, Adjust Dosage, Toxic, Ineffective, Unknown |
| CPIC Alignment | Level A/B evidence with guideline citations |

### 🤖 AI Features
| Feature | Description |
|---------|-------------|
| LLM Integration | OpenAI GPT models for clinical explanations |
| RAG Architecture | Retrieval-Augmented Generation with CPIC guidelines from SQLite database |
| Structured Citations | Variant links to NCBI dbSNP + guideline sources |
| Fallback System | Precomputed guidelines when API unavailable |

### 🎨 User Experience
| Feature | Description |
|---------|-------------|
| 1-Click Demo Patients | Normal Metabolizer, Intermediate Metabolizer, Poor Metabolizer, Rapid Metabolizer |
| File Upload | Standard file picker with VCF validation |
| Multi-Drug Support | Toggle between single drug dropdown and comma-separated multiple drug input |
| Polypharmacy Warnings | Detects metabolic bottlenecks when multiple drugs compete for same enzyme |
| PDF Export | Clinical-grade reports with letterhead |
| JSON Export | Schema-compliant output with copy/download |
| Zero-Retention | HIPAA-ready privacy - files purged after processing |
| Dark/Light Mode | Theme toggle with localStorage persistence |

---

## 💻 Tech Stack

### Backend
| Technology | Purpose |
|------------|---------|
| FastAPI | REST API framework |
| Uvicorn | ASGI server |
| Python 3.10+ | Core language |
| SQLite3 | CPIC guideline database (34+ phenotype rules) |
| OpenAI API | GPT-4 for clinical explanations |
| python-multipart | File upload handling |
| python-dotenv | Environment management |

### Frontend
| Technology | Purpose |
|------------|---------|
| Next.js 16 | React framework |
| TypeScript | Type safety |
| TailwindCSS | Styling |
| jsPDF | PDF generation |
| jsPDF-autotable | PDF tables |

---

## 📦 Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- OpenAI API key

### Backend Setup

```bash
# Clone repository
git clone https://github.com/yourusername/pharmaguard.git
cd pharmaguard/pharma_guard

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
echo "OPENAI_API_KEY=your_api_key_here" > .env
echo "USE_PRECOMPUTED=false" >> .env

# Initialize database
python database.py
python seed_data.py

# Run server
uvicorn main:app --reload