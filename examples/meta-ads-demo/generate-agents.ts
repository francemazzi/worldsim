import type { AgentConfig } from "../../src/types/AgentTypes.js";

export interface SegmentConfig {
  id: string;
  weight: number;
  label: string;
  personalities: string[];
  adAttitude: string;
}

export interface MetaAdsScenarioConfig {
  agentCount: number;
  neighborhoodGroups: number;
  maxContacts: number;
  segments: SegmentConfig[];
}

const FIRST_NAMES = [
  "Marco", "Giulia", "Luca", "Sara", "Andrea", "Francesca", "Matteo", "Chiara",
  "Alessandro", "Valentina", "Davide", "Elena", "Simone", "Martina", "Federico",
  "Alessia", "Riccardo", "Laura", "Stefano", "Silvia", "Gabriele", "Anna",
  "Nicola", "Paola", "Tommaso", "Giorgia", "Filippo", "Roberta", "Daniele",
  "Elisa", "Antonio", "Monica", "Paolo", "Cristina", "Luigi", "Teresa",
  "Giovanni", "Lucia", "Vincenzo", "Angela", "Salvatore", "Rosa", "Giuseppe",
  "Maria", "Francesco", "Carmela", "Pietro", "Teresa", "Alberto", "Ilaria",
];

const LAST_NAMES = [
  "Rossi", "Bianchi", "Ferrari", "Russo", "Romano", "Colombo", "Ricci", "Marino",
  "Greco", "Bruno", "Gallo", "Conti", "De Luca", "Costa", "Fontana", "Caruso",
  "Mancini", "Rizzo", "Lombardi", "Moretti", "Barbieri", "Ferrara", "Santoro",
  "Martini", "Leone", "Longo", "Gentile", "Martinelli", "Vitale", "Serra",
];

const PROFESSIONS = [
  "Impiegato", "Insegnante", "Infermiere", "Commerciante", "Freelancer",
  "Studente universitario", "Graphic designer", "Operaio", "Avvocato",
  "Barista", "Programmatore", "Consulente", "Fisioterapista", "Autista",
  "Ristoratore", "Architetto", "Segretaria", "Meccanico", "Farmacista",
  "Personal trainer", "Giornalista", "Contabile", "Elettricista", "Psicologo",
];

const INCOME_LEVELS = [
  "reddito medio-basso",
  "reddito medio",
  "reddito medio-alto",
  "studente senza reddito fisso",
];

function pick<T>(arr: T[], index: number): T {
  return arr[index % arr.length]!;
}

function buildSegmentPool(segments: SegmentConfig[], count: number): SegmentConfig[] {
  const pool: SegmentConfig[] = [];
  let assigned = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isLast = i === segments.length - 1;
    const n = isLast
      ? count - assigned
      : Math.round(count * seg.weight);
    for (let j = 0; j < n; j++) {
      pool.push(seg);
    }
    assigned += n;
  }

  while (pool.length < count) {
    pool.push(segments[segments.length - 1]!);
  }
  while (pool.length > count) {
    pool.pop();
  }

  return pool;
}

function buildSystemPrompt(
  name: string,
  age: number,
  profession: string,
  income: string,
  segment: SegmentConfig,
): string {
  return `Sei ${name}, ${age} anni, ${profession} con ${income}. Segmento: ${segment.label}.
Personalità: ${segment.personalities.join(", ")}.
Rapporto con gli annunci: ${segment.adAttitude}

Stai scrollando il feed social (simile a Instagram/Facebook). Parli sempre in italiano.
Quando vedi un annuncio nel feed, reagisci in modo realistico: puoi ignorarlo, commentarlo
mentalmente con "observe", parlarne con amici del tuo gruppo con "speak", o mostrare interesse.
Non essere sempre positivo: molti utenti ignorano le ads. Se parli dell'annuncio, sii specifico
su cosa ti convince o ti infastidisce (prezzo, prova gratuita, coach AI, abbonamento ricorrente).
Evita risposte generiche.`;
}

export function generateAgents(config: MetaAdsScenarioConfig): AgentConfig[] {
  const { agentCount, neighborhoodGroups, maxContacts, segments } = config;
  const segmentPool = buildSegmentPool(segments, agentCount);
  const agentsPerGroup = Math.ceil(agentCount / neighborhoodGroups);
  const agents: AgentConfig[] = [];

  for (let i = 0; i < agentCount; i++) {
    const segment = segmentPool[i]!;
    const groupIdx = Math.floor(i / agentsPerGroup);
    const groupId = `social-group-${groupIdx}`;
    const firstName = pick(FIRST_NAMES, i);
    const lastName = pick(LAST_NAMES, i * 7 + 3);
    const name = `${firstName} ${lastName}`;
    const age = 22 + (i * 17) % 43;
    const profession = pick(PROFESSIONS, i * 3 + groupIdx);
    const income = pick(INCOME_LEVELS, i + groupIdx);

    agents.push({
      id: `user-${i}`,
      role: "person",
      name,
      llmTier: "light",
      iterationsPerTick: 1,
      tokenBudget: { perTick: 1200, policy: "pause" },
      neighborhood: {
        maxContacts,
        groups: [groupId],
      },
      systemPrompt: buildSystemPrompt(name, age, profession, income, segment),
      profile: {
        name,
        age,
        profession,
        personality: [...segment.personalities],
        goals: [
          "Usare i social per svago",
          segment.id === "fitness_enthusiast"
            ? "Mantenere la forma fisica"
            : "Gestire tempo e budget con attenzione",
        ],
        backstory: `${segment.label}. ${segment.adAttitude}`,
        customFields: {
          segment: segment.id,
          segmentLabel: segment.label,
          socialGroup: groupId,
        },
      },
    });
  }

  return agents;
}
