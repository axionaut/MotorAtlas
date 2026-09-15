"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CircleGauge, Database, FileCheck2, GitCompareArrows, Globe2, History, Link2, Plus, RefreshCw, Search, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { atlasRequest, bulkIngestNhtsa, exportBackup, importBackup } from "@/lib/browser-api";
import { loadSeeds } from "@/lib/seed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";

type Counts = { makes: number; models: number; variants: number; observations: number; conflicts: number; markets: number };
type Source = { id: string; name: string; geography: string; license: string; reuseStatus: string; authorityRank: number; coverageTags: string[]; homepageUrl: string; adapterStatus: string };
type Run = { id: string; sourceName: string; status: string; scope: string; fetched: number; inserted: number; startedAt: string };
type Coverage = { attributeKey: string; observations: number; vehicles: number; sources: number };
type Vehicle = { id: string; canonicalName: string; make: string; model: string; market: string; modelYear: number | null; trim: string | null; bodyStyle: string | null; powertrain: string | null; transmission: string | null; driveType: string | null; completeness: number; reviewStatus: string; observationCount: number; sourceCount: number };
type Observation = { id: string; variantId?: string; attributeKey: string; valueText: string | null; valueNumber: number | null; unit: string | null; method: string; confidence: number; sourceUrl: string | null; sourceName: string; authorityRank: number };
type CompareData = { vehicles: Vehicle[]; attributes: Array<{ attributeKey: string; values: Array<Observation | null> }> };

const APP_VERSION = __APP_VERSION__;

const emptyCounts: Counts = { makes: 0, models: 0, variants: 0, observations: 0, conflicts: 0, markets: 0 };
const pretty = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const shownValue = (item: Observation | null) => item ? `${item.valueNumber ?? item.valueText ?? "—"}${item.unit ? ` ${item.unit}` : ""}` : "—";

export default function MotorAtlas() {
  const [tab, setTab] = useState("catalog");
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ vehicle: Vehicle; observations: Observation[] } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [compare, setCompare] = useState<CompareData>({ vehicles: [], attributes: [] });
  const [ingesting, setIngesting] = useState(false);
  const [total, setTotal] = useState(0);
  const [seeding, setSeeding] = useState("");
  const [bulk, setBulk] = useState<{ done: number; total: number; make: string } | null>(null);
  const bulkAbort = useRef<AbortController | null>(null);
  const [yearFrom, setYearFrom] = useState("2015");
  const [yearTo, setYearTo] = useState(String(new Date().getFullYear() + 1));
  const [makeInput, setMakeInput] = useState("Toyota");
  const [yearInput, setYearInput] = useState(String(new Date().getFullYear()));
  const [evidence, setEvidence] = useState({ attributeKey: "", value: "", unit: "", sourceId: "nhtsa-vpic", sourceUrl: "", confidence: "90", method: "documented" });

  const loadOverview = useCallback(async () => {
    const response = await atlasRequest("/overview"); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the database overview.");
    setCounts({ ...emptyCounts, ...data.counts }); setSources(data.sources || []); setRuns(data.runs || []); setCoverage(data.coverage || []);
  }, []);

  const loadCatalog = useCallback(async (q = query, selectedMarket = market) => {
    const params = new URLSearchParams(); if (q) params.set("q", q); if (selectedMarket) params.set("market", selectedMarket);
    const response = await atlasRequest(`/catalog?${params}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load vehicles.");
    setVehicles(data.vehicles || []); setMarkets(data.markets || []); setTotal(Number(data.total ?? data.vehicles?.length ?? 0));
  }, [query, market]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { await Promise.all([loadOverview(), loadCatalog()]); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Refresh failed."); }
    finally { setLoading(false); }
  }, [loadCatalog, loadOverview]);

  useEffect(() => { void (async () => {
    try { const added = await loadSeeds(setSeeding); if (added) toast.success(`${added.toLocaleString()} vehicle identities loaded from the bundled catalogue.`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load the bundled catalogue."); }
    finally { setSeeding(""); await refresh(); }
  })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setTimeout(() => void loadCatalog().catch((error) => toast.error(error.message)), 250); return () => window.clearTimeout(timer); }, [query, market]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected.length) { setCompare({ vehicles: [], attributes: [] }); return; }
    atlasRequest(`/compare?ids=${selected.join(",")}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setCompare(data); }).catch((error) => toast.error(error.message));
  }, [selected, counts.observations]);

  useEffect(() => {
    const context = (document as unknown as { modelContext?: { registerTool: (tool: unknown, options?: unknown) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "search_vehicle_catalog", title: "Search vehicle catalog", description: "Search canonical vehicle records by make, model or market.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, market: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (input: { query?: string; market?: string }) => { const q = String(input?.query || ""); const m = String(input?.market || ""); setQuery(q); setMarket(m); setTab("catalog"); const response = await atlasRequest(`/catalog?${new URLSearchParams({ q, market: m })}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Search failed"); setVehicles(data.vehicles || []); return { resultCount: data.vehicles?.length || 0 }; },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const toggleVehicle = (id: string, checked: boolean) => setSelected((current) => {
    if (!checked) return current.filter((item) => item !== id); if (current.includes(id)) return current;
    if (current.length >= 4) { toast.error("Compare up to four vehicles at once."); return current; } return [...current, id];
  });

  const openVehicle = async (vehicle: Vehicle) => { const response = await atlasRequest(`/vehicle/${vehicle.id}`); const data = await response.json(); if (!response.ok) return toast.error(data.error || "Could not open vehicle."); setDetail({ vehicle, observations: data.observations || [] }); setDetailOpen(true); };

  const runIngestion = async (event: React.FormEvent) => {
    event.preventDefault(); setIngesting(true);
    try { const response = await atlasRequest("/ingest/nhtsa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ make: makeInput, year: Number(yearInput) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Ingestion failed."); toast.success(`${data.imported} ${data.make} model records imported for ${data.year}.`); await refresh(); setTab("catalog"); setQuery(data.make); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Ingestion failed."); } finally { setIngesting(false); }
  };

  const runBulk = async (event: React.FormEvent) => {
    event.preventDefault();
    const controller = new AbortController(); bulkAbort.current = controller;
    setBulk({ done: 0, total: 0, make: "Listing manufacturers…" });
    try {
      const totals = await bulkIngestNhtsa(Number(yearFrom), Number(yearTo), (progress) => setBulk({ done: progress.done, total: progress.total, make: progress.make }), controller.signal);
      toast[controller.signal.aborted ? "info" : "success"](`${totals.inserted.toLocaleString()} new identities, ${totals.updated.toLocaleString()} confirmed${controller.signal.aborted ? " before stopping" : ""}.`);
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Bulk ingestion failed."); }
    finally { bulkAbort.current = null; setBulk(null); }
  };

  const addEvidence = async (event: React.FormEvent) => {
    event.preventDefault(); if (!detail) return;
    try { const response = await atlasRequest("/observations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...evidence, variantId: detail.vehicle.id, confidence: Number(evidence.confidence) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not add evidence."); toast.success(data.conflictCreated ? "Evidence saved; disagreement flagged." : "Evidence saved with provenance."); setEvidence((current) => ({ ...current, attributeKey: "", value: "", unit: "", sourceUrl: "" })); await Promise.all([openVehicle(detail.vehicle), loadOverview(), loadCatalog()]); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not add evidence."); }
  };

  const selectedNames = useMemo(() => selected.map((id) => vehicles.find((vehicle) => vehicle.id === id)?.canonicalName).filter(Boolean) as string[], [selected, vehicles]);

  return <div className="min-h-screen bg-[#f2f0ea] text-[#151719]">
    <Toaster position="top-right" />
    <header className="border-b border-white/10 bg-[#111416] text-white"><div className="flex w-full items-center justify-between px-5 py-4 sm:px-8"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#f7b955] text-[#111416]"><CircleGauge className="size-5" /></div><div><div className="font-mono text-[11px] uppercase tracking-[.24em] text-[#f7b955]">Global vehicle intelligence</div><h1 className="text-xl font-bold tracking-tight">MotorAtlas</h1></div></div><div className="hidden items-center gap-5 text-sm text-white/60 md:flex"><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#f7b955]" /> Provenance first</span><span className="font-mono text-xs">v{APP_VERSION} · GitHub Pages</span></div></div></header>
    <main className="w-full px-5 py-5 sm:px-8 sm:py-7">
      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm">
        <span className="text-black/60">Saved in this browser. Export a backup to keep a copy or move to another device.</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void exportBackup().catch((error) => toast.error(error.message))}>Export backup</Button>
          <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 font-medium focus-within:ring-2">Import backup<input className="sr-only" type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { const added = await importBackup(file); toast.success(`${added} records restored.`); await refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not restore backup."); } }} /></label>
        </div>
      </section>
      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"><Metric label="Makes" value={counts.makes} icon={<Globe2 />} /><Metric label="Models" value={counts.models} icon={<Database />} /><Metric label="Market variants" value={counts.variants} icon={<CircleGauge />} /><Metric label="Observations" value={counts.observations} icon={<FileCheck2 />} /><Metric label="Markets" value={counts.markets} icon={<Globe2 />} /><Metric label="Open conflicts" value={counts.conflicts} icon={<AlertTriangle />} alert={counts.conflicts > 0} /></section>
      <Tabs value={tab} onValueChange={setTab} className="gap-0"><div className="mb-4 flex flex-col justify-between gap-3 border-b border-black/10 lg:flex-row lg:items-end"><TabsList variant="line" className="h-auto gap-5 overflow-x-auto p-0"><TabsTrigger value="catalog" className="h-11 px-0">Catalog</TabsTrigger><TabsTrigger value="compare" className="h-11 px-0">Compare {selected.length ? <b className="rounded-full bg-[#d88711] px-1.5 text-[11px] text-black">{selected.length}</b> : null}</TabsTrigger><TabsTrigger value="sources" className="h-11 px-0">Sources</TabsTrigger><TabsTrigger value="ingest" className="h-11 px-0">Ingestion</TabsTrigger></TabsList><div className="pb-2 font-mono text-xs text-black/45">{seeding || (loading ? "Synchronising…" : `${sources.length} sources · ${counts.observations} preserved facts`)}</div></div>

        <TabsContent value="catalog"><section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_12px_35px_rgba(20,22,23,.06)]"><div className="flex flex-col gap-3 border-b border-black/10 p-4 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-lg font-bold">Canonical vehicle records</h2><p className="text-sm text-black/50">One identity per market-specific model-year configuration.{total > vehicles.length ? ` Showing ${vehicles.length.toLocaleString()} of ${total.toLocaleString()} matches.` : ""}</p></div><div className="flex flex-col gap-2 sm:flex-row"><label className="relative min-w-[280px]"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/40" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Make, model, trim…" className="h-10 pl-9" /><span className="sr-only">Search vehicles</span></label><NativeSelect value={market} onChange={(event) => setMarket(event.target.value)} className="h-10 min-w-[130px]"><NativeSelectOption value="">All markets</NativeSelectOption>{markets.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}</NativeSelect></div></div>{vehicles.length ? <Table><TableHeader><TableRow className="bg-[#f7f6f2]"><TableHead className="w-12" /><TableHead>Vehicle identity</TableHead><TableHead>Market</TableHead><TableHead>Status</TableHead><TableHead>Evidence</TableHead><TableHead className="w-[190px]">Completeness</TableHead></TableRow></TableHeader><TableBody>{vehicles.map((vehicle) => <TableRow key={vehicle.id} className="cursor-pointer" onClick={() => void openVehicle(vehicle)}><TableCell onClick={(event) => event.stopPropagation()}><Checkbox checked={selected.includes(vehicle.id)} onCheckedChange={(checked) => toggleVehicle(vehicle.id, checked === true)} aria-label={`Compare ${vehicle.canonicalName}`} /></TableCell><TableCell><div className="font-semibold">{vehicle.canonicalName}</div><div className="mt-1 text-xs text-black/45">{[vehicle.bodyStyle, vehicle.powertrain, vehicle.transmission, vehicle.driveType].filter(Boolean).join(" · ") || "Identity record awaiting technical enrichment"}</div></TableCell><TableCell><Badge variant="outline" className="font-mono">{vehicle.market}</Badge></TableCell><TableCell><StatusBadge status={vehicle.reviewStatus} /></TableCell><TableCell><b className="font-mono">{vehicle.observationCount}</b><span className="text-black/40"> / {vehicle.sourceCount} sources</span></TableCell><TableCell><div className="flex items-center gap-3"><Progress value={vehicle.completeness} className="bg-black/10 [&_[data-slot=progress-indicator]]:bg-[#d88711]" /><span className="w-9 font-mono text-xs">{vehicle.completeness}%</span></div></TableCell></TableRow>)}</TableBody></Table> : seeding || loading ? <LoadingCatalog message={seeding || "Reading stored identities…"} /> : <EmptyCatalog onIngest={() => setTab("ingest")} />}</section></TabsContent>
        <TabsContent value="compare"><ComparePanel data={compare} selectedNames={selectedNames} onOpenCatalog={() => setTab("catalog")} /></TabsContent>
        <TabsContent value="sources"><div className="grid gap-4 xl:grid-cols-[1.4fr_.6fr]"><section className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_12px_35px_rgba(20,22,23,.06)]"><div className="mb-5 flex justify-between"><div><h2 className="text-lg font-bold">Free-source federation</h2><p className="text-sm text-black/50">Authority, reuse rights and readiness stay explicit.</p></div><Badge className="bg-[#111416]">{sources.length} mapped</Badge></div><div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{sources.map((source) => <SourceCard key={source.id} source={source} />)}</div></section><section className="rounded-2xl border border-black/10 bg-[#171a1c] p-5 text-white"><div className="flex items-center gap-2 text-[#f7b955]"><Sparkles className="size-4" /><span className="font-mono text-xs uppercase tracking-[.16em]">Coverage ledger</span></div><h2 className="mt-3 text-xl font-bold">What the corpus can prove</h2><div className="mt-5 space-y-4">{coverage.length ? coverage.map((item) => <div key={item.attributeKey}><div className="mb-1.5 flex justify-between text-sm"><span>{pretty(item.attributeKey)}</span><span className="font-mono text-white/45">{item.vehicles} cars · {item.sources} sources</span></div><Progress value={Math.min(100, counts.variants ? (item.vehicles / counts.variants) * 100 : 0)} className="bg-white/10 [&_[data-slot=progress-indicator]]:bg-[#f7b955]" /></div>) : <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/55">Coverage appears as evidence arrives. Empty is honest; invented completeness is numerology wearing a tie.</p>}</div></section></div></TabsContent>
        <TabsContent value="ingest"><div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]"><div className="space-y-4"><section className="rounded-2xl border border-black/10 bg-white p-6"><Badge className="mb-4 bg-[#e8f4ea] text-[#16612d]">Live adapter</Badge><h2 className="text-2xl font-bold">Refresh every manufacturer</h2><p className="mt-2 text-black/55">The bundled catalogue already carries {counts.variants.toLocaleString()} identities across {counts.markets} markets, so nothing has to be typed in to start comparing. This pull refreshes US model-year identities for every car manufacturer NHTSA lists.</p><form onSubmit={runBulk} className="mt-6 space-y-4"><div className="grid grid-cols-2 gap-3"><Field label="From year"><Input type="number" min="1981" max={new Date().getFullYear() + 1} value={yearFrom} onChange={(event) => setYearFrom(event.target.value)} required /></Field><Field label="To year"><Input type="number" min="1981" max={new Date().getFullYear() + 1} value={yearTo} onChange={(event) => setYearTo(event.target.value)} required /></Field></div>{bulk ? <div className="space-y-2"><Progress value={bulk.total ? (bulk.done / bulk.total) * 100 : 0} className="bg-black/10 [&_[data-slot=progress-indicator]]:bg-[#d88711]" /><div className="flex items-center justify-between font-mono text-xs text-black/50"><span className="truncate">{bulk.make}</span><span>{bulk.done}/{bulk.total || "…"} makes</span></div><Button type="button" variant="outline" className="w-full" onClick={() => bulkAbort.current?.abort()}>Stop and keep what loaded</Button></div> : <Button className="h-11 w-full bg-[#d88711] text-black hover:bg-[#efaa3e]"><UploadCloud /> Pull all manufacturers</Button>}</form><p className="mt-4 text-xs text-black/45">Market presence outside the United States comes from the bundled VehiclesDB catalogue (CC BY 4.0). Year-specific identities for other markets arrive with their national adapters.</p></section><details className="rounded-2xl border border-black/10 bg-white p-6"><summary className="cursor-pointer text-sm font-bold">Single manufacturer pull</summary><p className="mt-2 text-sm text-black/55">Targets one manufacturer and model year. Repeat pulls update instead of duplicating.</p><form onSubmit={runIngestion} className="mt-4 space-y-4"><Field label="Manufacturer"><Input value={makeInput} onChange={(event) => setMakeInput(event.target.value)} required /></Field><Field label="Model year"><Input type="number" min="1981" max={new Date().getFullYear() + 1} value={yearInput} onChange={(event) => setYearInput(event.target.value)} required /></Field><Button disabled={ingesting} variant="outline" className="h-11 w-full">{ingesting ? <RefreshCw className="animate-spin" /> : <UploadCloud />}{ingesting ? "Pulling records…" : "Run single pull"}</Button></form></details></div><section className="rounded-2xl border border-black/10 bg-white p-6"><div className="flex items-center gap-2"><History className="size-4 text-[#d88711]" /><h2 className="text-lg font-bold">Ingestion ledger</h2></div><div className="mt-5 space-y-3">{runs.length ? runs.map((run) => <div key={run.id} className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><strong>{run.sourceName}</strong><StatusBadge status={run.status} /></div><div className="mt-1 font-mono text-xs text-black/45">{run.scope} · {new Date(run.startedAt).toLocaleString()}</div></div><div className="flex gap-5 text-sm"><span><b className="font-mono text-lg">{run.fetched}</b> fetched</span><span><b className="font-mono text-lg">{run.inserted}</b> written</span></div></div>) : <div className="grid min-h-[280px] place-items-center rounded-xl border border-dashed border-black/15 text-black/45">No ingestion runs yet.</div>}</div></section></div></TabsContent>
      </Tabs>
    </main>
    <footer className="w-full px-5 pb-8 text-xs text-black/45 sm:px-8">Bundled catalogue: global market presence from <a className="font-semibold text-[#9b5d00]" href="https://vehiclesdb.com" target="_blank" rel="noreferrer">Vehicle data by VehiclesDB</a> (CC BY 4.0), United States model-year identities from <a className="font-semibold text-[#9b5d00]" href="https://vpic.nhtsa.dot.gov/api/" target="_blank" rel="noreferrer">NHTSA vPIC</a>. Evidence you attach stays in this browser.</footer>
    <Dialog open={detailOpen} onOpenChange={setDetailOpen}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-2xl p-0">{detail && <><DialogHeader className="border-b border-black/10 bg-[#171a1c] p-6 pr-12 text-white"><div className="font-mono text-xs uppercase tracking-[.15em] text-[#f7b955]">Canonical variant · {detail.vehicle.market}</div><DialogTitle className="text-2xl">{detail.vehicle.canonicalName}</DialogTitle><DialogDescription className="text-white/55">{detail.observations.length} source observations preserved independently</DialogDescription></DialogHeader><div className="grid gap-6 p-6 lg:grid-cols-[1.05fr_.95fr]"><div><h3 className="mb-3 font-bold">Evidence ledger</h3>{detail.observations.length ? <div className="space-y-2">{detail.observations.map((item) => <div key={item.id} className="rounded-xl border border-black/10 p-3"><div className="flex justify-between"><div><div className="text-sm font-semibold">{pretty(item.attributeKey)}</div><div className="mt-1 text-lg font-bold">{shownValue(item)}</div></div><span className="font-mono text-xs text-black/40">{item.confidence}%</span></div><div className="mt-2 flex items-center gap-2 text-xs text-black/45"><FileCheck2 className="size-3" />{item.sourceName} · {item.method}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto text-[#a86300]"><Link2 className="inline size-3" /> Source</a>}</div></div>)}</div> : <div className="rounded-xl border border-dashed border-black/15 p-8 text-center text-sm text-black/45">Identity exists; technical evidence has not arrived yet.</div>}</div><form onSubmit={addEvidence} className="rounded-xl bg-[#f5f3ed] p-4"><h3 className="mb-4 font-bold"><Plus className="mr-2 inline size-4 text-[#d88711]" />Attach sourced evidence</h3><div className="space-y-3"><Field label="Attribute"><Input value={evidence.attributeKey} onChange={(event) => setEvidence({ ...evidence, attributeKey: event.target.value })} placeholder="torque_nm" required /></Field><div className="grid grid-cols-[1fr_110px] gap-2"><Field label="Value"><Input value={evidence.value} onChange={(event) => setEvidence({ ...evidence, value: event.target.value })} required /></Field><Field label="Unit"><Input value={evidence.unit} onChange={(event) => setEvidence({ ...evidence, unit: event.target.value })} placeholder="Nm" /></Field></div><Field label="Source"><NativeSelect value={evidence.sourceId} onChange={(event) => setEvidence({ ...evidence, sourceId: event.target.value })} className="w-full">{sources.map((source) => <NativeSelectOption key={source.id} value={source.id}>{source.name}</NativeSelectOption>)}</NativeSelect></Field><Field label="Source URL"><Input type="url" value={evidence.sourceUrl} onChange={(event) => setEvidence({ ...evidence, sourceUrl: event.target.value })} placeholder="https://…" /></Field><div className="grid grid-cols-2 gap-2"><Field label="Method"><NativeSelect value={evidence.method} onChange={(event) => setEvidence({ ...evidence, method: event.target.value })} className="w-full"><NativeSelectOption value="documented">Documented</NativeSelectOption><NativeSelectOption value="claimed">Claimed</NativeSelectOption><NativeSelectOption value="owner_reported">Owner reported</NativeSelectOption><NativeSelectOption value="regulatory">Regulatory</NativeSelectOption><NativeSelectOption value="measured">Measured</NativeSelectOption><NativeSelectOption value="derived">Derived</NativeSelectOption></NativeSelect></Field><Field label="Confidence"><Input type="number" min="1" max="100" value={evidence.confidence} onChange={(event) => setEvidence({ ...evidence, confidence: event.target.value })} /></Field></div><Button className="w-full bg-[#171a1c]">Preserve observation</Button></div></form></div><DialogFooter className="border-t border-black/10 px-6 py-4" showCloseButton /></>}</DialogContent></Dialog>
  </div>;
}

function Metric({ label, value, icon, alert = false }: { label: string; value: number; icon: React.ReactNode; alert?: boolean }) { return <div className={`rounded-xl border p-3.5 shadow-sm ${alert ? "border-[#ce4b36]/25 bg-[#fff1ed]" : "border-black/10 bg-white"}`}><div className="flex items-center justify-between text-black/40"><span className="text-xs font-semibold uppercase tracking-[.08em]">{label}</span><span className="[&_svg]:size-4">{icon}</span></div><div className={`mt-3 font-mono text-2xl font-bold ${alert ? "text-[#b63827]" : ""}`}>{Number(value || 0).toLocaleString()}</div></div>; }
function StatusBadge({ status }: { status: string }) { const tone = status === "completed" || status === "profiled" ? "bg-[#e8f4ea] text-[#16612d]" : status === "failed" ? "bg-[#ffe9e5] text-[#a92d1c]" : status === "running" ? "bg-[#fff1cf] text-[#835600]" : "bg-[#efeee9] text-black/55"; return <Badge className={`${tone} border-0`}>{pretty(status || "unknown")}</Badge>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-bold uppercase tracking-[.08em] text-black/50">{label}</span>{children}</label>; }
function LoadingCatalog({ message }: { message: string }) { return <div className="grid min-h-[360px] place-items-center p-8 text-center"><div><RefreshCw className="mx-auto mb-4 size-8 animate-spin text-[#d88711]" /><h3 className="text-lg font-bold">{message}</h3><p className="mt-2 text-sm text-black/50">The bundled catalogue is stored once in this browser; later visits open instantly.</p></div></div>; }
function EmptyCatalog({ onIngest }: { onIngest: () => void }) { return <div className="grid min-h-[360px] place-items-center p-8 text-center"><div className="max-w-lg"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-[#111416] text-[#f7b955]"><Database /></div><h3 className="text-xl font-bold">No vehicles match yet.</h3><p className="mt-2 text-black/55">The bundled catalogue loads on first visit. If nothing appears, refresh every manufacturer from the live adapters, then attach technical evidence without overwriting anything.</p><Button className="mt-5 bg-[#d88711] text-black hover:bg-[#efaa3e]" onClick={onIngest}><UploadCloud /> Open ingestion <ArrowRight /></Button></div></div>; }
function SourceCard({ source }: { source: Source }) { return <article className="rounded-xl border border-black/10 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{source.name}</h3><p className="mt-0.5 text-xs text-black/45">{source.geography} · authority tier {source.authorityRank}</p></div><Badge className={source.adapterStatus === "live" ? "bg-[#e8f4ea] text-[#16612d]" : source.adapterStatus === "mapped" ? "bg-[#fff1cf] text-[#835600]" : "bg-[#efeee9] text-black/55"}>{pretty(source.adapterStatus)}</Badge></div><div className="mt-3 flex flex-wrap gap-1.5">{source.coverageTags.map((tag) => <span key={tag} className="rounded-md bg-[#f3f1eb] px-2 py-1 text-xs text-black/60">{tag}</span>)}</div><div className="mt-4 flex items-center justify-between border-t border-black/10 pt-3 text-xs"><span className="text-black/45">{source.license}</span><a href={source.homepageUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#9b5d00]">Open source <ArrowRight className="inline size-3" /></a></div></article>; }
function ComparePanel({ data, selectedNames, onOpenCatalog }: { data: CompareData; selectedNames: string[]; onOpenCatalog: () => void }) {
  if (data.vehicles.length < 2) return <section className="grid min-h-[480px] place-items-center rounded-2xl border border-black/10 bg-white p-8 text-center"><div className="max-w-lg"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-[#111416] text-[#f7b955]"><GitCompareArrows /></div><h2 className="text-xl font-bold">Select at least two vehicle records</h2><p className="mt-2 text-black/50">The comparison uses the highest-authority observation for every attribute and keeps its source visible.</p>{selectedNames.length === 1 && <p className="mt-3 text-sm font-semibold">Selected: {selectedNames[0]}</p>}<Button variant="outline" className="mt-5" onClick={onOpenCatalog}>Choose vehicles</Button></div></section>;
  const identityRows = [["Market", "market"], ["Model year", "modelYear"], ["Trim", "trim"], ["Body style", "bodyStyle"], ["Powertrain", "powertrain"], ["Transmission", "transmission"], ["Drive type", "driveType"], ["Completeness", "completeness"]] as const;
  return <section className="overflow-hidden rounded-2xl border border-black/10 bg-white"><div className="border-b border-black/10 p-5"><h2 className="text-lg font-bold">Evidence-aware comparison</h2><p className="text-sm text-black/50">Best-supported values lead; their source remains visible.</p></div><Table><TableHeader><TableRow className="bg-[#171a1c] hover:bg-[#171a1c]"><TableHead className="w-44 text-white/55">Attribute</TableHead>{data.vehicles.map((vehicle) => <TableHead key={vehicle.id} className="min-w-[220px] whitespace-normal py-4 text-white"><span className="block text-base">{vehicle.canonicalName}</span><span className="mt-1 block font-mono text-xs font-normal text-[#f7b955]">{vehicle.market} · {vehicle.completeness}%</span></TableHead>)}</TableRow></TableHeader><TableBody>{identityRows.map(([label, key]) => <TableRow key={key}><TableCell className="font-semibold text-black/55">{label}</TableCell>{data.vehicles.map((vehicle) => <TableCell key={vehicle.id}>{key === "completeness" ? `${vehicle[key] ?? 0}%` : String(vehicle[key] ?? "—")}</TableCell>)}</TableRow>)}{data.attributes.map((attribute) => <TableRow key={attribute.attributeKey}><TableCell className="font-semibold text-black/55">{pretty(attribute.attributeKey)}</TableCell>{attribute.values.map((value, index) => <TableCell key={index}><b>{shownValue(value)}</b>{value && <div className="mt-1 text-xs text-black/40">{value.sourceName} · {value.confidence}%</div>}</TableCell>)}</TableRow>)}</TableBody></Table>{!data.attributes.length && <div className="border-t p-5 text-sm text-black/45">These records have no technical observations yet. Open a vehicle and attach sourced evidence.</div>}</section>;
}
