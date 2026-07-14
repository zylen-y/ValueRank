import type { Article } from '../engine/types'

// axes: [ML Systems, Chips & Compute, Energy, Policy, Markets, Biotech, Security, Product]
const a = (
  id: string,
  title: string,
  source: string,
  minutes: number,
  gain: number[],
  difficulty: number,
  engagement: number,
  tags: string[],
  clickbait = false,
): Article => ({ id, title, source, minutes, gain, difficulty, engagement, tags, clickbait })

export const ARTICLES: Article[] = [
  // --- deep explainers (high gain, modest engagement) ---
  a('e1', 'How Inference Actually Works: KV Caches, Batching, and Why Latency Is Expensive', 'Systems Weekly', 14, [0.35, 0.18, 0.02, 0, 0, 0, 0.02, 0.03], 0.35, 0.34, ['ai', 'ml']),
  a('e2', 'From Sand to Silicon: A Field Guide to the Modern Fab', 'Process Node', 18, [0.05, 0.4, 0.05, 0.03, 0.04, 0, 0, 0], 0.3, 0.31, ['chips']),
  a('e3', 'The Grid Interconnection Queue, Explained', 'Wattline', 12, [0, 0.04, 0.38, 0.12, 0.06, 0, 0, 0], 0.25, 0.22, ['energy', 'climate']),
  a('e4', 'Reading the EU AI Act Like a Lawyer (Without Being One)', 'Brussels Memo', 16, [0.08, 0, 0, 0.4, 0.03, 0, 0.06, 0], 0.3, 0.26, ['policy', 'ai']),
  a('e5', 'Datacenter Power Purchase Agreements: The Contracts Behind the Buildout', 'Wattline', 15, [0.05, 0.1, 0.35, 0.08, 0.18, 0, 0, 0], 0.45, 0.28, ['energy', 'datacenter', 'markets']),
  a('e6', 'Transformer Alternatives in 2026: State-Space Models in Production', 'Systems Weekly', 17, [0.42, 0.08, 0, 0, 0, 0, 0, 0], 0.55, 0.3, ['ai', 'ml']),
  a('e7', 'How AlphaFold Changed Drug Discovery Pipelines — and What It Didn’t', 'BenchSide', 15, [0.12, 0, 0, 0.02, 0.05, 0.4, 0, 0], 0.4, 0.29, ['biotech', 'ai']),
  a('e8', 'Prompt Injection Is a Systems Problem, Not a Prompt Problem', 'Zero Day Brief', 11, [0.14, 0, 0, 0.04, 0, 0, 0.38, 0.02], 0.35, 0.36, ['security', 'ai']),
  a('e9', 'Advanced Packaging: Why CoWoS Is the Real Bottleneck', 'Process Node', 13, [0.04, 0.42, 0.03, 0.02, 0.08, 0, 0, 0], 0.5, 0.27, ['chips']),
  a('e10', 'Nuclear SMRs and the Datacenter Demand Curve', 'Wattline', 14, [0.02, 0.06, 0.4, 0.15, 0.12, 0, 0, 0], 0.4, 0.33, ['energy', 'datacenter', 'climate']),
  a('e11', 'A Founder’s Guide to Model Evals That Actually Predict Product Quality', 'Shipping It', 12, [0.25, 0, 0, 0, 0.03, 0, 0.04, 0.3], 0.3, 0.32, ['ai', 'product']),
  a('e12', 'GPU Cloud Economics: Depreciation Schedules Decide Everything', 'The Margin', 13, [0.08, 0.22, 0.06, 0, 0.35, 0, 0, 0], 0.45, 0.3, ['chips', 'markets', 'ai']),
  a('e13', 'What a Modern SOC Looks Like When Half the Analysts Are Agents', 'Zero Day Brief', 14, [0.16, 0, 0, 0.03, 0, 0, 0.4, 0.04], 0.45, 0.31, ['security', 'ai']),
  a('e14', 'Cell Therapy Manufacturing: The Scale-Up Problem Nobody Solved', 'BenchSide', 16, [0, 0, 0.03, 0.06, 0.08, 0.42, 0, 0], 0.5, 0.21, ['biotech']),
  a('e15', 'Carbon Markets After Article 6: Prices, Registries, Integrity', 'Wattline', 15, [0, 0, 0.3, 0.22, 0.28, 0, 0, 0], 0.45, 0.19, ['climate', 'markets', 'policy']),
  a('e16', 'Continuous Pretraining and the End of the Model Version Number', 'Systems Weekly', 13, [0.38, 0.1, 0.02, 0, 0.03, 0, 0, 0.04], 0.6, 0.29, ['ai', 'ml']),
  a('e17', 'Export Controls, Explained Through One Shipment of H-Series GPUs', 'Brussels Memo', 12, [0.02, 0.2, 0, 0.36, 0.12, 0, 0.02, 0], 0.35, 0.35, ['policy', 'chips']),
  a('e18', 'Designing Onboarding for AI Products: Trust Before Capability', 'Shipping It', 10, [0.06, 0, 0, 0, 0.02, 0, 0.02, 0.38], 0.25, 0.3, ['product', 'ai']),
  a('e19', 'The Bull and Bear Cases for Vertical AI, With Actual Cohort Data', 'The Margin', 14, [0.06, 0, 0, 0.02, 0.4, 0, 0, 0.14], 0.4, 0.37, ['markets', 'ai']),
  a('e20', 'Liquid Cooling Retrofits: What It Takes to Convert a Legacy Hall', 'Process Node', 12, [0, 0.24, 0.3, 0, 0.05, 0, 0, 0], 0.45, 0.18, ['datacenter', 'energy', 'chips']),
  a('e21', 'Biosecurity Screening for DNA Synthesis: The New Baseline', 'BenchSide', 11, [0.02, 0, 0, 0.18, 0, 0.3, 0.24, 0], 0.4, 0.2, ['biotech', 'security', 'policy']),
  a('e22', 'Speculative Decoding, Distillation, and the Cost Curve of Intelligence', 'Systems Weekly', 15, [0.4, 0.14, 0.03, 0, 0.06, 0, 0, 0], 0.65, 0.28, ['ai', 'ml']),
  a('e23', 'Grid-Scale Batteries Are Now a Merchant Business', 'Wattline', 13, [0, 0.03, 0.36, 0.08, 0.2, 0, 0, 0], 0.4, 0.24, ['energy', 'climate', 'markets']),
  a('e24', 'Threat Modeling LLM Agents: Capabilities, Not Personas', 'Zero Day Brief', 13, [0.18, 0, 0, 0.05, 0, 0, 0.42, 0.03], 0.55, 0.27, ['security', 'ai']),
  a('e25', 'How Pharma Actually Buys AI: Procurement, Validation, Liability', 'BenchSide', 14, [0.1, 0, 0, 0.14, 0.16, 0.34, 0, 0.04], 0.45, 0.23, ['biotech', 'markets', 'ai']),
  a('e26', 'The Pricing Page Is the Product: Usage-Based AI SaaS in Practice', 'Shipping It', 11, [0.04, 0, 0, 0, 0.22, 0, 0, 0.36], 0.35, 0.33, ['product', 'markets']),

  // --- solid mid-tier news (moderate gain, decent engagement) ---
  a('n1', 'Anthropic and TSMC Sign Multi-Year Capacity Deal', 'The Margin', 6, [0.08, 0.14, 0.02, 0.02, 0.12, 0, 0, 0], 0.2, 0.55, ['ai', 'chips', 'markets']),
  a('n2', 'DOE Fast-Tracks Transmission Permits in Three Corridors', 'Wattline', 5, [0, 0, 0.16, 0.14, 0.04, 0, 0, 0], 0.15, 0.42, ['energy', 'policy']),
  a('n3', 'OpenAI Ships On-Device Distills for Flagship Phones', 'Systems Weekly', 6, [0.16, 0.1, 0, 0, 0.05, 0, 0.02, 0.06], 0.25, 0.6, ['ai', 'chips']),
  a('n4', 'FDA Clears First Fully AI-Designed Small Molecule for Phase II', 'BenchSide', 7, [0.06, 0, 0, 0.1, 0.06, 0.2, 0, 0], 0.25, 0.58, ['biotech', 'ai', 'policy']),
  a('n5', 'Major Breach Traced to Compromised MCP Server Supply Chain', 'Zero Day Brief', 6, [0.05, 0, 0, 0.03, 0, 0, 0.2, 0.02], 0.25, 0.62, ['security', 'ai']),
  a('n6', 'Sovereign AI Funds Pour $40B Into Gulf Datacenters', 'The Margin', 5, [0.02, 0.06, 0.1, 0.08, 0.16, 0, 0, 0], 0.2, 0.57, ['markets', 'datacenter', 'energy']),
  a('n7', 'EU Opens Formal Review of Recommender Transparency Rules', 'Brussels Memo', 5, [0.02, 0, 0, 0.18, 0.02, 0, 0.03, 0.04], 0.15, 0.4, ['policy', 'ai']),

  // --- engagement bait (viral, near-zero durable gain) ---
  // clickbait "gains" are mostly hype/FOMO drift — scattered, shallow, off any
  // deliberate goal direction (markets-FOMO, hot-takes, doom) with a trace of topic
  a('c1', 'You Won’t BELIEVE What Jensen Said About the Next GPU 🤯', 'HypeFeed', 3, [0.005, 0.01, 0, 0, 0.06, 0, 0, 0.05], 0.05, 0.97, ['chips', 'ai'], true),
  a('c2', 'This One Prompt Trick Makes Any Model 10x Smarter', 'HypeFeed', 2, [0.01, 0, 0, 0, 0.04, 0, 0, 0.06], 0.05, 0.95, ['ai', 'ml'], true),
  a('c3', 'AI Just Made Doctors OBSOLETE (Doctors Hate This)', 'HypeFeed', 3, [0.005, 0, 0, 0.04, 0.05, 0.01, 0, 0.02], 0.05, 0.93, ['biotech', 'ai'], true),
  a('c4', 'Top 10 AI Stocks That Could 100x by December', 'HypeFeed', 4, [0, 0, 0, 0, 0.08, 0, 0, 0.04], 0.05, 0.94, ['markets', 'ai'], true),
  a('c5', 'Hackers Can Now Steal Your Thoughts Through ChatGPT?!', 'HypeFeed', 3, [0.005, 0, 0, 0.03, 0.04, 0, 0.01, 0.04], 0.05, 0.92, ['security', 'ai'], true),
  a('c6', 'The Datacenter Apocalypse Is Coming for Your Electricity Bill', 'HypeFeed', 4, [0, 0, 0.01, 0.05, 0.06, 0, 0, 0.03], 0.1, 0.9, ['energy', 'datacenter'], true),
  a('c7', 'Why Everyone Is DELETING Their AI Apps Right Now', 'HypeFeed', 3, [0, 0, 0, 0.03, 0.05, 0, 0.01, 0.05], 0.05, 0.91, ['product', 'ai'], true),
]
