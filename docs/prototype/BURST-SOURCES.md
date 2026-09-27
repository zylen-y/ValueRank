# Burst demonstration sources

The demonstration contains **48 original editorial briefs**, each linked to a distinct primary publication, official documentation page, or original research paper. Sources were checked on **2026-09-26**. These are curated inputs prepared for the prototype, not 48 freshly scraped full articles and not a continuously harvested news feed.

Each item's publisher is labeled “· briefing”; its provenance is `editorial-brief`; its analysis is labeled `editorial`. Summaries and concept tags were prepared editorially. Product suggestions are our interpretations of the linked material, not claims that a publisher has validated ValueRank. The supporting quote in each record is a contiguous sentence from **our own brief**, not a quotation attributed to the publisher.

No Jev decisions or target ranking scores are embedded in this corpus. A live run must obtain its judgments from the configured decision provider. The curated mixture makes differing relevance and familiarity visible; it is not a representative benchmark, a held-out evaluation set, or evidence of recommendation quality across a population. Throughput measured over these short prepared briefs describes the decision stage; it does not include fetching 48 pages or asking an LLM to analyze 48 full articles.

The ten learning-focused entries cover learner difficulty, recall, task-specific assessment, memory, and bounded tutoring workflows. Ten ranking entries cover explicit criteria, calibration, training data, partial feedback, ranking objectives, and redundancy. Eight web foundations offer familiar material to compress. Twenty adjacent resources introduce realistic competing interests; their relative usefulness depends on the current goal rather than a hard-coded “noise” label.

Known-concept chips have exact corpus matches for `React state`, `React effects`, `Server Components`, and `Spaced repetition`. No known-concept state is imposed on the user's actual profile by this file. Estimated reading minutes describe a short exploration of the linked resource; they are editorial estimates, not measured reading time or demonstrated time savings. Model fine-tuning is not performed by loading this corpus.

## References

### Language learning and agent product design

| Brief | Primary reference |
| --- | --- |
| Predict when a learner will forget, then choose the next lesson | [Settles & Meeder](https://aclanthology.org/P16-1174/) |
| A language level should describe what someone can actually do | [Council of Europe](https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions) |
| Give the tutor the right memory, instead of every previous message | [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) |
| A reliable tutor starts with a small, observable workflow | [Anthropic](https://www.anthropic.com/engineering/building-effective-agents) |
| Turn bad tutoring moments into a regression dataset | [OpenAI](https://developers.openai.com/api/docs/guides/evals) |
| Generate a lesson object your application can actually trust | [Vercel AI SDK](https://ai-sdk.dev/docs/reference/ai-sdk-core/output) |
| Separate what happened in a lesson from what the learner knows | [LangChain](https://docs.langchain.com/oss/javascript/concepts/memory) |
| Personalize the challenge, not just the topic | [Duolingo](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/) |
| Review scheduling needs actual recall outcomes | [Open Spaced Repetition](https://github.com/open-spaced-repetition/fsrs4anki) |
| A transcript is evidence for a speaking tutor, not a pronunciation grade | [Radford et al.](https://arxiv.org/abs/2212.04356) |

### Decision models, ranking, and learning from feedback

| Brief | Primary reference |
| --- | --- |
| Use Jev for repeated decisions and an LLM for the explanation | [Vercel](https://vercel.com/i/what-is-jev) |
| The quality of a ranking starts with the question you ask | [TypeSafe AI](https://typesafe.ai/blog/introducing-system-one-models-and-jev) |
| Before training a decision model, define the event it must predict | [Together AI](https://www.together.ai/blog/how-to-train-your-own-jev) |
| A recommender only learns about the items it exposes | [Vowpal Wabbit](https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/python_Contextual_bandits_and_Vowpal_Wabbit.html) |
| Train for the order of a list, not only individual scores | [TensorFlow](https://www.tensorflow.org/ranking/overview) |
| Cold-start recommendations need more than an item ID | [TensorFlow Recommenders](https://www.tensorflow.org/recommenders/examples/featurization) |
| If a model says 80%, define what happens eight times in ten | [Guo et al.](https://arxiv.org/abs/1706.04599) |
| Preference pairs need context to become useful training data | [Rafailov et al.](https://arxiv.org/abs/2305.18290) |
| Prediction uncertainty deserves a contract of its own | [Vovk et al.](https://arxiv.org/abs/1902.06579) |
| Five highly relevant articles can still repeat the same idea | [Carbonell & Goldstein](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf) |

### Familiar React and Next.js foundations

| Brief | Primary reference |
| --- | --- |
| Compose a page from small React components | [React](https://react.dev/learn/describing-the-ui) |
| Pass data into a component with props | [React](https://react.dev/learn/passing-props-to-a-component) |
| Render an empty state with ordinary JavaScript conditions | [React](https://react.dev/learn/conditional-rendering) |
| Stable keys help React follow items through a changing list | [React](https://react.dev/learn/rendering-lists) |
| Keep interactive values in React state | [React](https://react.dev/learn/state-a-components-memory) |
| Use an Effect to synchronize with an external system | [React](https://react.dev/learn/synchronizing-with-effects) |
| Cache an expensive calculation only when it helps | [React](https://react.dev/reference/react/useMemo) |
| Choose the server or client boundary for each component | [Next.js](https://nextjs.org/docs/app/getting-started/server-and-client-components) |

### Adjacent web, design, and infrastructure reading

| Brief | Primary reference |
| --- | --- |
| Align nested cards with CSS subgrid | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Subgrid) |
| Animate a change of view without losing visual continuity | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) |
| Motion should explain what changed | [Apple](https://developer.apple.com/design/human-interface-guidelines/motion) |
| Translucent materials need a reason beyond looking glossy | [Apple](https://developer.apple.com/design/human-interface-guidelines/materials) |
| Move suitable browser workloads onto the GPU | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) |
| WebAssembly brings a portable compilation target to the browser | [WebAssembly](https://webassembly.org/docs/high-level-goals/) |
| Make a web experience usable after the connection disappears | [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps) |
| A live connection still needs flow control and lifecycle handling | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) |
| Describe asynchronous states with a discriminated union | [TypeScript](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) |
| An index speeds some reads and adds work to writes | [PostgreSQL](https://www.postgresql.org/docs/current/indexes-intro.html) |
| Choose JSON storage deliberately instead of hiding every field in a blob | [PostgreSQL](https://www.postgresql.org/docs/current/datatype-json.html) |
| Understand what SQLite write-ahead logging changes | [SQLite](https://sqlite.org/wal.html) |
| A container image should be reproducible from its build inputs | [Docker](https://docs.docker.com/build/concepts/overview/) |
| A Deployment reconciles desired replicas with a running cluster | [Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) |
| A counter, a gauge, and a latency histogram answer different questions | [Prometheus](https://prometheus.io/docs/concepts/metric_types/) |
| A chart scale is a mapping decision, not decoration | [D3](https://d3js.org/d3-scale) |
| Variable fonts expose a range of typography inside one font resource | [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Fonts/Variable_fonts) |
| Auto layout helps a design survive changing content | [Figma](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout) |
| Separate repeatable content from its page layout | [Framer](https://www.framer.com/academy/lessons/getting-started-with-the-framer-cms) |
| Subtle text still needs enough contrast to read | [W3C WAI](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
