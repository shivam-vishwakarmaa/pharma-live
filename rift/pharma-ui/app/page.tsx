"use client";

import { useEffect, useMemo, useState } from "react";

type Tone = "safe" | "adjust" | "toxic" | "unknown";

type SingleResult = {
  patient_id?: string;
  drug?: string;
  timestamp?: string;
  risk_assessment?: { risk_label?: string; severity?: string; confidence_score?: number };
  pharmacogenomic_profile?: {
    primary_gene?: string;
    phenotype?: string;
    diplotype?: string;
    detected_variants?: Array<{ rsid?: string; gene?: string; allele?: string; function?: string; genotype?: string }>;
  };
  clinical_recommendation?: { action?: string; guideline_source?: string };
  llm_generated_explanation?: {
    summary?: string;
    mechanism?: string;
    recommendation?: string;
    citations?: Array<{ rsid?: string; gene?: string; dbSNP_url?: string }>;
    variant_citations?: Array<{ rsid?: string; gene?: string; dbSNP_url?: string }>;
  };
  quality_metrics?: {
    total_variants_analyzed?: number;
    variants_detected?: number;
    vcf_parsing_success?: boolean;
  };
};

type BatchResult = {
  patient_id?: string;
  timestamp?: string;
  drugs_analyzed?: string[];
  polypharmacy_warnings?: Array<{ warning?: string; clinical_note?: string }>;
  llm_explanations?: Record<string, { summary?: string; mechanism?: string; recommendation?: string }>;
  results?: Record<
    string,
    {
      risk_label?: string;
      severity?: string;
      confidence_score?: number;
      gene?: string;
      phenotype?: string;
      diplotype?: string;
      recommendation?: string;
    }
  >;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const APP_BG = "#F0F4F8";
const CARD_BG = "#FFFFFF";
const NAVY = "#0F4C81";
const CYAN = "#00B4D8";
const SAFE = "#10B981";
const ADJUST = "#F59E0B";
const TOXIC = "#EF4444";
const TEXT = "#1E293B";
const MUTED = "#64748B";

const CORE_DRUGS = ["CODEINE", "WARFARIN", "CLOPIDOGREL", "SIMVASTATIN", "AZATHIOPRINE", "FLUOROURACIL"];
const EXTRA_DRUGS = ["OMEPRAZOLE", "FLUOXETINE", "PAROXETINE", "RISPERIDONE", "IBUPROFEN"];
const DRUG_OPTIONS = [...new Set([...CORE_DRUGS, ...EXTRA_DRUGS])];
const CORE_GENES = ["CYP2D6", "CYP2C19", "CYP2C9", "SLCO1B1", "TPMT", "DPYD"];
const DRUG_PRIMARY_GENE: Record<string, string> = {
  CODEINE: "CYP2D6",
  WARFARIN: "CYP2C9",
  CLOPIDOGREL: "CYP2C19",
  SIMVASTATIN: "SLCO1B1",
  AZATHIOPRINE: "TPMT",
  FLUOROURACIL: "DPYD",
  FLUOXETINE: "CYP2D6",
  PAROXETINE: "CYP2D6",
  RISPERIDONE: "CYP2D6",
  IBUPROFEN: "CYP2C9",
  OMEPRAZOLE: "CYP2C19",
};
const LOADING_STEPS = [
  "Parsing VCF...",
  "Identifying 6 Critical Genes...",
  "Running AI Confidence Scoring...",
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function toneFor(label?: string): Tone {
  const v = (label || "").toLowerCase();
  if (v === "safe") return "safe";
  if (v.includes("adjust")) return "adjust";
  if (v.includes("toxic") || v.includes("ineffective")) return "toxic";
  return "unknown";
}

function riskColor(label?: string) {
  const tone = toneFor(label);
  if (tone === "safe") return SAFE;
  if (tone === "adjust") return ADJUST;
  if (tone === "toxic") return TOXIC;
  return MUTED;
}

function riskBadgeStyle(label?: string) {
  const tone = toneFor(label);
  if (tone === "safe") {
    return { borderColor: "#A7F3D0", background: "#ECFDF5", color: "#047857" };
  }
  if (tone === "adjust") {
    return { borderColor: "#FDE68A", background: "#FFFBEB", color: "#B45309" };
  }
  if (tone === "toxic") {
    return { borderColor: "#FECACA", background: "#FEF2F2", color: "#B91C1C" };
  }
  return { borderColor: "#CBD5E1", background: "#F8FAFC", color: "#475569" };
}

function parseDrugTokens(input: string): string[] {
  return input
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);
}

function toFriendlyApiError(message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("file must be a .vcf") || m.includes("invalid file type")) {
    return "Invalid file type. Please upload a `.vcf` genomic file.";
  }
  if (m.includes("file size exceeds") || m.includes("too large")) {
    return "VCF file is too large. Maximum allowed size is 5 MB.";
  }
  if (m.includes("vcf headers are missing") || m.includes("does not look like a valid vcf")) {
    return "The uploaded file is not a valid VCF (required headers are missing).";
  }
  if (m.includes("not found at path")) {
    return "The selected VCF path could not be found. Check the path and try again.";
  }
  if (m.includes("internal server error")) {
    return "The server could not complete this analysis. Please retry in a moment.";
  }
  if (m.includes("request failed (500)")) {
    return "Analysis could not be completed due to a server issue. Please retry in a moment.";
  }
  return message || "Analysis failed. Please review inputs and try again.";
}

function collectAnnotationNotes(single: SingleResult | null, batch: BatchResult | null): string[] {
  const notes: string[] = [];

  if (single) {
    if (single.quality_metrics?.vcf_parsing_success === false) {
      notes.push("VCF parsing was only partially successful. Some annotations may be unavailable.");
    }
    if ((single.quality_metrics?.variants_detected ?? 0) === 0) {
      notes.push("No target pharmacogenomic variants were detected in the uploaded VCF.");
    }
    if (!single.pharmacogenomic_profile?.primary_gene || single.pharmacogenomic_profile?.primary_gene === "Unknown") {
      notes.push("Primary gene annotation is missing for this result.");
    }
    if (!single.pharmacogenomic_profile?.phenotype || single.pharmacogenomic_profile?.phenotype === "Unknown") {
      notes.push("Phenotype could not be confidently inferred from available annotations.");
    }
    const drugName = (single.drug || "").toUpperCase();
    const expectedGene = DRUG_PRIMARY_GENE[drugName];
    const reportedGene = single.pharmacogenomic_profile?.primary_gene || "Unknown";
    if (drugName && expectedGene && (!reportedGene || reportedGene === "Unknown")) {
      notes.push(`Analysis Incomplete: We couldn't predict the risk for ${drugName} because the required gene data (${expectedGene}) is missing from this patient's file.`);
    }
  }

  if (batch) {
    const entries = Object.entries(batch.results || {});
    if (!entries.length) {
      notes.push("No per-drug annotations were returned for this batch request.");
    } else {
      const unknownCount = entries.filter(([, r]) => !r.gene || r.gene === "Unknown" || !r.phenotype || r.phenotype === "Unknown").length;
      if (unknownCount > 0) {
        notes.push(`${unknownCount} drug result(s) include missing gene/phenotype annotations.`);
      }
      for (const [drug, result] of entries) {
        const expectedGene = DRUG_PRIMARY_GENE[drug.toUpperCase()];
        if (expectedGene && (!result.gene || result.gene === "Unknown")) {
          notes.push(`Analysis Incomplete: ${drug} requires ${expectedGene} data, which is missing in this VCF. Other available drug analyses are still shown.`);
        }
      }
    }
  }

  return notes;
}

async function validateVcfFile(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith(".vcf")) return "Upload Failed: Please upload a valid `.vcf` file under 5 MB.";
  if (file.size > MAX_FILE_SIZE) return `Upload Failed: File is too large. Maximum allowed size is ${formatBytes(MAX_FILE_SIZE)}.`;
  try {
    const sample = (await file.text()).slice(0, 12000);
    if (!sample.trim()) return "Upload Failed: The file appears empty or unreadable.";
    const lines = sample.split(/\r?\n/).slice(0, 120);
    const hasVcfHeader = lines.some((line) => line.startsWith("##fileformat=VCF"));
    const hasChromHeader = lines.some((line) => line.startsWith("#CHROM"));
    if (!hasVcfHeader || !hasChromHeader) {
      return "Upload Failed: This file is not a valid VCF (required VCF headers are missing).";
    }
    const hasDataRow = lines.some((line) => !!line && !line.startsWith("#") && line.split("\t").length >= 8);
    if (!hasDataRow) {
      return "Upload Failed: VCF structure is incomplete or corrupted (variant rows are missing).";
    }
  } catch {
    return "Upload Failed: Unable to read this file. It may be corrupted or encoded in an unsupported format.";
  }
  return "";
}

function ConfidenceDonut({ value, color }: { value: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className="relative h-14 w-14 rounded-full"
      style={{
        background: `conic-gradient(${color} ${clamped * 3.6}deg, #E2E8F0 0deg)`,
      }}
    >
      <div className="absolute inset-[6px] flex items-center justify-center rounded-full bg-white text-[11px] font-semibold" style={{ color: TEXT }}>
        {clamped}%
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
      <div className="h-4 w-24 rounded bg-slate-200" />
      <div className="mt-3 h-3 w-3/4 rounded bg-slate-200" />
      <div className="mt-2 h-3 w-2/3 rounded bg-slate-200" />
      <div className="mt-4 h-8 w-20 rounded bg-slate-200" />
    </div>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [apiError, setApiError] = useState("");
  const [inputError, setInputError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  const [drugInput, setDrugInput] = useState("CLOPIDOGREL");
  const [selectedDrugs, setSelectedDrugs] = useState<string[]>(["CLOPIDOGREL"]);
  const [multiMode, setMultiMode] = useState(false);

  const [singleResult, setSingleResult] = useState<SingleResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [copyState, setCopyState] = useState("");
  const annotationNotes = useMemo(() => collectAnnotationNotes(singleResult, batchResult), [singleResult, batchResult]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => setLoadingStep((p) => (p + 1) % LOADING_STEPS.length), 1200);
    return () => window.clearInterval(id);
  }, [loading]);

  const rawJson = useMemo(() => {
    if (singleResult) return JSON.stringify(singleResult, null, 2);
    if (batchResult) return JSON.stringify(batchResult, null, 2);
    return "";
  }, [singleResult, batchResult]);

  const fileUsagePercent = file ? Math.min(100, Math.round((file.size / MAX_FILE_SIZE) * 100)) : 0;

  const riskCards = useMemo(() => {
    if (singleResult) {
      return [
        {
          drug: singleResult.drug || "Unknown",
          label: singleResult.risk_assessment?.risk_label || "Unknown",
          severity: singleResult.risk_assessment?.severity || "unknown",
          confidence: Math.round((singleResult.risk_assessment?.confidence_score || 0) * 100),
          gene: singleResult.pharmacogenomic_profile?.primary_gene || "N/A",
          phenotype: singleResult.pharmacogenomic_profile?.phenotype || "N/A",
          recommendation: singleResult.llm_generated_explanation?.recommendation || singleResult.clinical_recommendation?.action || "N/A",
        },
      ];
    }
    return Object.entries(batchResult?.results || {}).map(([drug, details]) => ({
      drug,
      label: details.risk_label || "Unknown",
      severity: details.severity || "unknown",
      confidence: Math.round((details.confidence_score || 0) * 100),
      gene: details.gene || "N/A",
      phenotype: details.phenotype || "N/A",
      recommendation: details.recommendation || "N/A",
    }));
  }, [singleResult, batchResult]);

  const detectedGenes = useMemo(() => {
    const genes = new Set<string>();
    if (singleResult?.pharmacogenomic_profile?.primary_gene) genes.add(singleResult.pharmacogenomic_profile.primary_gene);
    (singleResult?.pharmacogenomic_profile?.detected_variants || []).forEach((v) => {
      if (v.gene) genes.add(v.gene);
    });
    Object.values(batchResult?.results || {}).forEach((r) => {
      if (r.gene) genes.add(r.gene);
    });
    return genes;
  }, [singleResult, batchResult]);

  const riskSummary = useMemo(() => {
    const safe = riskCards.filter((r) => toneFor(r.label) === "safe").length;
    const adjust = riskCards.filter((r) => toneFor(r.label) === "adjust").length;
    const toxic = riskCards.filter((r) => toneFor(r.label) === "toxic").length;
    return { safe, adjust, toxic };
  }, [riskCards]);

  async function assignFile(candidate: File | null) {
    setFileError("");
    setApiError("");
    if (!candidate) {
      setFile(null);
      return;
    }
    const err = await validateVcfFile(candidate);
    if (err) {
      setFile(null);
      setFileError(err);
      return;
    }
    setFile(candidate);
  }

  function addDrug(drug: string) {
    const tokens = parseDrugTokens(drug);
    if (!tokens.length) return;
    if (tokens.some((value) => !/^[A-Z0-9\-\s]+$/.test(value))) {
      setInputError("Drug name contains unsupported characters.");
      return;
    }
    if (multiMode) {
      setSelectedDrugs((prev) => {
        const merged = [...prev];
        for (const token of tokens) {
          if (!merged.includes(token)) merged.push(token);
        }
        return merged;
      });
    } else {
      setSelectedDrugs([tokens[0]]);
    }
    setDrugInput("");
    setInputError("");
  }

  function removeDrug(drug: string) {
    setSelectedDrugs((prev) => prev.filter((d) => d !== drug));
  }

  function setMode(mode: "single" | "multi") {
    const nextMulti = mode === "multi";
    setMultiMode(nextMulti);
    if (!nextMulti && selectedDrugs.length > 1) {
      setSelectedDrugs([selectedDrugs[0]]);
    }
  }

  async function handleAnalyze() {
    setInputError("");
    setApiError("");

    // Accept manual comma-separated input even if user did not click "Add".
    const pendingTokens = parseDrugTokens(drugInput);
    let effectiveDrugs = [...selectedDrugs];
    if (pendingTokens.length) {
      if (multiMode) {
        for (const token of pendingTokens) {
          if (!effectiveDrugs.includes(token)) effectiveDrugs.push(token);
        }
      } else {
        effectiveDrugs = [pendingTokens[0]];
      }
      setSelectedDrugs(effectiveDrugs);
      setDrugInput("");
    }

    if (!file) {
      setFileError("Please upload a valid VCF file.");
      return;
    }
    if (!effectiveDrugs.length) {
      setInputError("Select at least one drug.");
      return;
    }

    setLoading(true);
    setLoadingStep(0);
    setSingleResult(null);
    setBatchResult(null);

    try {
      const formData = new FormData();
      formData.append("vcf", file);

      if (!multiMode || effectiveDrugs.length === 1) {
        formData.append("drug", effectiveDrugs[0]);
        const res = await fetch("http://127.0.0.1:8000/analyze", { method: "POST", body: formData });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `Request failed (${res.status})`);
        setSingleResult(data as SingleResult);
      } else {
        formData.append("drugs", effectiveDrugs.join(","));
        const res = await fetch("http://127.0.0.1:8000/analyze/batch", { method: "POST", body: formData });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `Request failed (${res.status})`);
        setBatchResult(data as BatchResult);
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Unexpected API error.";
      setApiError(toFriendlyApiError(raw));
    } finally {
      setLoading(false);
    }
  }

  async function copyJson() {
    if (!rawJson) return;
    try {
      await navigator.clipboard.writeText(rawJson);
      setCopyState("Copied");
      window.setTimeout(() => setCopyState(""), 1200);
    } catch {
      setApiError("Clipboard permission denied.");
    }
  }

  function downloadJson() {
    if (!rawJson) return;
    const id = singleResult?.patient_id || batchResult?.patient_id || "patient";
    const blob = new Blob([rawJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pharmaguard-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden" style={{ background: APP_BG, color: TEXT }}>
      <div className="pointer-events-none absolute -top-24 -left-20 h-72 w-72 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(0,180,216,0.24) 0%, rgba(0,180,216,0) 70%)" }} />
      <div className="pointer-events-none absolute top-20 right-0 h-80 w-80 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(15,76,129,0.22) 0%, rgba(15,76,129,0) 72%)" }} />
      <header className="sticky top-0 z-40 border-b border-[#0B3A63]" style={{ background: NAVY }}>
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-lg font-bold tracking-wide text-white">
              Pharma<span style={{ color: CYAN }}>Guard</span>
            </h1>
            <p className="text-[11px] text-blue-100/90">Clinical Intelligence Console</p>
          </div>
          <h1 className="sr-only">
            Pharma<span style={{ color: CYAN }}>Guard</span>
          </h1>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#2B6CA3] bg-[#0C426F] px-3 py-1 text-xs font-medium text-white">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: CYAN }} />
            AI Engine Active
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        <section className="reveal mb-4 rounded-2xl border p-4 sm:p-5" style={{ borderColor: "#D7E1EC", background: "linear-gradient(140deg, rgba(255,255,255,0.9) 0%, rgba(235,248,255,0.85) 55%, rgba(233,248,252,0.9) 100%)", boxShadow: "0 10px 25px -15px rgba(15,76,129,0.4)" }}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: NAVY }}>Deep Clinical View</p>
              <h2 className="mt-1 text-xl font-semibold sm:text-2xl" style={{ color: TEXT }}>Pharmacogenomic Risk Command Center</h2>
              <p className="mt-1 text-sm" style={{ color: MUTED }}>Single-click genomic interpretation with CPIC-aligned recommendations and LLM-backed mechanism insights.</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border bg-white px-3 py-2 text-center" style={{ borderColor: "#BBF7D0" }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: SAFE }}>Safe</p>
                <p className="text-lg font-bold">{riskSummary.safe}</p>
              </div>
              <div className="rounded-xl border bg-white px-3 py-2 text-center" style={{ borderColor: "#FDE68A" }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: ADJUST }}>Adjust</p>
                <p className="text-lg font-bold">{riskSummary.adjust}</p>
              </div>
              <div className="rounded-xl border bg-white px-3 py-2 text-center" style={{ borderColor: "#FECACA" }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: TOXIC }}>Toxic</p>
                <p className="text-lg font-bold">{riskSummary.toxic}</p>
              </div>
            </div>
          </div>
        </section>
        <section
          className="reveal rounded-2xl border p-4 shadow-sm sm:p-5"
          style={{
            background: "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)",
            borderColor: dragActive ? CYAN : "#D7E1EC",
            boxShadow: "0 12px 22px -18px rgba(15, 76, 129, 0.6)",
          }}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                Upload Dashboard
              </p>
              <label
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragActive(false);
                  await assignFile(e.dataTransfer.files?.[0] || null);
                }}
                className="block cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all duration-300 hover:-translate-y-0.5 sm:p-8"
                style={{
                  borderColor: dragActive ? CYAN : "#B9C9D9",
                  background: dragActive ? "#E9F8FC" : "#F8FBFF",
                }}
              >
                <input className="hidden" type="file" accept=".vcf" onChange={async (e) => assignFile(e.target.files?.[0] || null)} />
                <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[#BFEFF8] bg-[#E8FAFE]">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke={CYAN} strokeWidth="1.8">
                    <path d="M7 3c2 2 2 4 0 6s-2 4 0 6 2 4 0 6" />
                    <path d="M17 3c-2 2-2 4 0 6s2 4 0 6-2 4 0 6" />
                    <path d="M8 8h8M8 16h8" />
                  </svg>
                </div>
                <p className="text-sm font-medium">Drag and drop .vcf file or click to browse</p>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                  Supported format: `.vcf`
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <span className="rounded-full border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "#BEE3F8", background: "#EBF8FF", color: NAVY }}>
                    5 MB max
                  </span>
                  <span
                    className="rounded-full border px-2 py-1 text-[11px] font-semibold"
                    style={{
                      borderColor: file && !fileError ? "#A7F3D0" : "#CBD5E1",
                      background: file && !fileError ? "#ECFDF5" : "#F1F5F9",
                      color: file && !fileError ? "#047857" : "#475569",
                    }}
                  >
                    {file && !fileError ? "Ready to Process" : "Waiting for Valid VCF"}
                  </span>
                </div>
                <div className="mx-auto mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full" style={{ width: `${fileUsagePercent}%`, background: fileError ? TOXIC : NAVY }} />
                </div>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                  {file ? `${file.name} (${formatBytes(file.size)})` : "No file selected"}
                </p>
              </label>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                Drug Selector
              </p>
              <div className="rounded-xl border bg-[#F8FBFF] p-3 sm:p-4" style={{ borderColor: "#D7E1EC", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)" }}>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: MUTED }}>
                    Analysis Mode
                  </p>
                  <div className="inline-flex rounded-lg border bg-white p-1" style={{ borderColor: "#D7E1EC" }}>
                    <button
                      type="button"
                      onClick={() => setMode("single")}
                      className="rounded-md px-3 py-1 text-xs font-semibold transition"
                      style={{ background: !multiMode ? NAVY : "transparent", color: !multiMode ? "#fff" : MUTED }}
                    >
                      Single
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("multi")}
                      className="rounded-md px-3 py-1 text-xs font-semibold transition"
                      style={{ background: multiMode ? NAVY : "transparent", color: multiMode ? "#fff" : MUTED }}
                    >
                      Multi
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    list="drug-options"
                    value={drugInput}
                    onChange={(e) => setDrugInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addDrug(drugInput);
                      }
                    }}
                    placeholder="Search or add drug"
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: "#C7D4E3", background: "#fff" }}
                  />
                  <button
                    type="button"
                    onClick={() => addDrug(drugInput)}
                    className="rounded-lg px-3 py-2 text-xs font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
                    style={{ background: NAVY }}
                  >
                    Add
                  </button>
                </div>
                <datalist id="drug-options">
                  {DRUG_OPTIONS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>

                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedDrugs.map((d) => (
                    <span key={d} className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5" style={{ borderColor: "#9ADDF0", background: "#E9F8FC", color: NAVY }}>
                      {d}
                      <button type="button" onClick={() => removeDrug(d)} className="rounded-full px-1 font-bold" style={{ color: CYAN }}>
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs" style={{ color: MUTED }}>
                    {multiMode ? `${selectedDrugs.length} drugs selected for batch analysis` : "Single-drug analysis active"}
                  </p>
                  {selectedDrugs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDrugs([selectedDrugs[0]])}
                      className="text-xs font-semibold"
                      style={{ color: NAVY }}
                    >
                      Keep one
                    </button>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {CORE_DRUGS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => addDrug(d)}
                      className="rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors duration-200 hover:bg-[#EFF6FF]"
                      style={{ borderColor: "#D7E1EC", background: "#fff", color: MUTED }}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={loading}
                  className="mt-5 w-full rounded-full px-5 py-3 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 disabled:opacity-60"
                  style={{ background: NAVY, boxShadow: "0 4px 10px rgba(15,76,129,0.25)" }}
                >
                  Analyze Genomic Profile
                </button>
              </div>
            </div>
          </div>

          {(fileError || inputError || apiError) && (
            <div className="mt-4 space-y-2">
              {!!fileError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{fileError}</p>}
              {!!inputError && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{inputError}</p>}
              {!!apiError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{apiError}</p>}
            </div>
          )}
        </section>

        {loading && (
          <section className="reveal mt-6 rounded-2xl border p-4 shadow-sm sm:p-5" style={{ background: CARD_BG, borderColor: "#D7E1EC", boxShadow: "0 12px 22px -18px rgba(15, 76, 129, 0.6)" }}>
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: CYAN }} />
              <p className="text-sm font-semibold" style={{ color: NAVY }}>
                {LOADING_STEPS[loadingStep]}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </section>
        )}

        {(singleResult || batchResult) && !loading && (
          <section className="mt-6 space-y-4">
            {!!annotationNotes.length && (
              <div className="reveal rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
                  Annotation Notes
                </p>
                <div className="mt-2 space-y-1">
                  {annotationNotes.map((note) => (
                    <p key={note} className="text-sm text-amber-900">
                      {note}
                    </p>
                  ))}
                </div>
                <p className="mt-2 text-xs text-amber-800">
                  Results are shown where possible. Consider re-running with a richer VCF or validating upstream annotations.
                </p>
              </div>
            )}
            <div className="reveal rounded-2xl border p-4 shadow-sm" style={{ background: CARD_BG, borderColor: "#D7E1EC", boxShadow: "0 12px 22px -18px rgba(15, 76, 129, 0.5)" }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                    Patient Identity
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {singleResult?.patient_id || batchResult?.patient_id || "N/A"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                    Timestamp
                  </p>
                  <p className="mt-1 text-sm">{singleResult?.timestamp || batchResult?.timestamp || "N/A"}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="space-y-3">
                <div className="reveal rounded-2xl border p-4 shadow-sm" style={{ background: CARD_BG, borderColor: "#D7E1EC", boxShadow: "0 12px 22px -18px rgba(15, 76, 129, 0.5)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                      Risk Matrix
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold">
                      <span className="rounded-full border px-2 py-1" style={{ borderColor: "#A7F3D0", background: "#ECFDF5", color: "#047857" }}>Green = Safe</span>
                      <span className="rounded-full border px-2 py-1" style={{ borderColor: "#FDE68A", background: "#FFFBEB", color: "#B45309" }}>Yellow = Adjust</span>
                      <span className="rounded-full border px-2 py-1" style={{ borderColor: "#FECACA", background: "#FEF2F2", color: "#B91C1C" }}>Red = Toxic/Ineffective</span>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {riskCards.map((card) => (
                      <div key={card.drug} className="rounded-xl border bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" style={{ borderLeft: `6px solid ${riskColor(card.label)}`, borderColor: "#D7E1EC" }}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{card.drug}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase" style={riskBadgeStyle(card.label)}>
                                {card.label}
                              </span>
                              <span className="text-xs" style={{ color: MUTED }}>
                                Severity: {card.severity}
                              </span>
                            </div>
                          </div>
                          <ConfidenceDonut value={card.confidence} color={CYAN} />
                        </div>
                        <p className="mt-2 text-xs" style={{ color: MUTED }}>
                          Gene: {card.gene} | Phenotype: {card.phenotype}
                        </p>
                        <p className="mt-2 text-xs">
                          <span className="font-semibold" style={{ color: NAVY }}>
                            Recommendation:
                          </span>{" "}
                          {card.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="reveal rounded-2xl p-4 shadow-sm" style={{ background: "linear-gradient(160deg, #1E293B 0%, #0F172A 100%)", color: "#F8FAFC", boxShadow: "0 12px 20px -14px rgba(0, 0, 0, 0.6)" }}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Pharmacogenomic Profile</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <p>
                      <span className="text-slate-400">Primary Gene:</span> {singleResult?.pharmacogenomic_profile?.primary_gene || "N/A"}
                    </p>
                    <p>
                      <span className="text-slate-400">Phenotype:</span> {singleResult?.pharmacogenomic_profile?.phenotype || "N/A"}
                    </p>
                    <p>
                      <span className="text-slate-400">Diplotype:</span> {singleResult?.pharmacogenomic_profile?.diplotype || "N/A"}
                    </p>
                    <div className="pt-1">
                      <p className="text-xs text-slate-400">Detected Core Genes:</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {CORE_GENES.map((g) => (
                          <span key={g} className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: detectedGenes.has(g) ? "#34D399" : "#475569", color: detectedGenes.has(g) ? "#6EE7B7" : "#94A3B8" }}>
                            {g}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="reveal rounded-2xl border p-4 shadow-sm"
                  style={{
                    background: CARD_BG,
                    borderColor: "#7DDFF2",
                    boxShadow: "0 0 0 1px rgba(0,180,216,0.25), 0 4px 10px rgba(0,180,216,0.12)",
                  }}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: CYAN }}>
                    LLM Explanation
                  </p>
                  {singleResult && (
                    <>
                      <p className="mt-2 text-sm">{singleResult.llm_generated_explanation?.summary || "LLM summary unavailable."}</p>
                      <p className="mt-2 text-sm" style={{ color: MUTED, lineHeight: 1.6 }}>
                        {singleResult.llm_generated_explanation?.mechanism || "Mechanism details unavailable."}
                      </p>
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 transition-all duration-200 hover:shadow-sm">
                        <p className="text-xs font-semibold text-amber-800">Dosing Recommendation (CPIC-aligned)</p>
                        <p className="mt-1 text-sm">
                          {singleResult.llm_generated_explanation?.recommendation || singleResult.clinical_recommendation?.action || "CPIC-aligned recommendation pending clinician review."}
                        </p>
                      </div>
                    </>
                  )}
                  {batchResult && (
                    <div className="mt-2 space-y-3">
                      {Object.entries(batchResult.llm_explanations || {}).map(([drug, exp]) => (
                        <div key={drug} className="rounded-lg border border-cyan-100 bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: NAVY }}>
                            {drug}
                          </p>
                          <p className="mt-1 text-sm">{exp.summary || "LLM summary unavailable."}</p>
                          <p className="mt-1 text-sm" style={{ color: MUTED, lineHeight: 1.5 }}>
                            {exp.mechanism || "Mechanism details unavailable."}
                          </p>
                          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                            <p className="text-[11px] font-semibold text-amber-800">Dosing Recommendation (CPIC-aligned)</p>
                            <p className="mt-1 text-xs">{exp.recommendation || "CPIC-aligned recommendation pending clinician review."}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {!!batchResult?.polypharmacy_warnings?.length && (
                  <div className="reveal rounded-2xl border border-red-200 bg-red-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">Polypharmacy Warnings</p>
                    <div className="mt-2 space-y-2">
                      {batchResult.polypharmacy_warnings.map((w, i) => (
                        <div key={`${w.warning || "w"}-${i}`} className="rounded-lg border border-red-200 bg-white p-2 text-sm">
                          <p className="font-semibold text-red-800">{w.warning}</p>
                          <p className="mt-1 text-xs text-red-700">{w.clinical_note}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="reveal rounded-2xl border p-4 shadow-sm" style={{ background: CARD_BG, borderColor: "#D7E1EC", boxShadow: "0 12px 22px -18px rgba(15, 76, 129, 0.5)" }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#EFF6FF]" style={{ borderColor: "#C7D4E3", color: NAVY }} onClick={() => setRawOpen((v) => !v)}>
                  {rawOpen ? "Hide Raw JSON" : "View Raw JSON"}
                </button>
                {rawOpen && (
                  <div className="flex gap-2">
                    <button type="button" onClick={copyJson} className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#EFF6FF]" style={{ borderColor: "#C7D4E3", color: NAVY }}>
                      {copyState || "Copy JSON"}
                    </button>
                    <button type="button" onClick={downloadJson} className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#EFF6FF]" style={{ borderColor: "#C7D4E3", color: NAVY }}>
                      Download
                    </button>
                  </div>
                )}
              </div>
              {rawOpen && (
                <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-slate-700 bg-[#0F172A] p-3 text-xs leading-relaxed text-slate-100">
                  {rawJson}
                </pre>
              )}
            </div>
          </section>
        )}
      </main>
      <style jsx global>{`
        .reveal {
          animation: rise-in 420ms ease-out both;
        }
        @keyframes rise-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
