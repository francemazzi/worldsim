import type { WorldSimPlugin, AgentTool } from "../../types/PluginTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";

export type SkillCategory =
  | "movement"
  | "social"
  | "physical"
  | "farming"
  | "technology"
  | "spiritual"
  | "academic"
  | "cooking"
  | "crafting";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pick<T>(...items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 1): number {
  const v = Math.random() * (max - min) + min;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/* ------------------------------------------------------------------ */
/*  movement                                                           */
/* ------------------------------------------------------------------ */

const movementTools: AgentTool[] = [
  {
    name: "walk_to",
    description:
      "Cammina verso una destinazione specifica. Consuma energia ma permette di esplorare il mondo.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Luogo di destinazione" },
      },
      required: ["destination"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { destination } = input as { destination: string };
      const observations = [
        "Il sentiero e' tranquillo, si sentono gli uccelli cantare.",
        "Un vento leggero accompagna il cammino.",
        "Lungo la strada incontri un vecchio albero coperto di muschio.",
        "Il sole filtra tra le nuvole illuminando il paesaggio.",
        "Un ruscello scorre accanto al sentiero.",
      ];
      return {
        arrived: true,
        location: destination,
        energyCost: 10,
        observation: pick(...observations),
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "look_around",
    description:
      "Osserva l'ambiente circostante. Puoi specificare un focus per concentrarti su qualcosa di specifico.",
    inputSchema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Elemento su cui concentrare l'attenzione (opzionale)",
        },
      },
      required: [],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { focus } = input as { focus?: string };
      const baseDetails = [
        "Alberi e cespugli circondano l'area.",
        "Si sente il rumore dell'acqua in lontananza.",
        "Qualche persona cammina nelle vicinanze.",
        "Un edificio antico domina la piazza.",
      ];
      const details = baseDetails.slice(0, randInt(2, 4));
      const description = focus
        ? `Osservando con attenzione ${focus}, noti dettagli interessanti.`
        : "Ti guardi intorno con calma, assorbendo l'ambiente.";
      return {
        description,
        details,
        tick: ctx.tickCount,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/*  social                                                             */
/* ------------------------------------------------------------------ */

const socialTools: AgentTool[] = [
  {
    name: "greet",
    description:
      "Saluta qualcuno. Puoi scegliere lo stile: formale, informale o caloroso.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Persona da salutare" },
        style: {
          type: "string",
          enum: ["formal", "casual", "warm"],
          description: "Stile del saluto (opzionale, default: casual)",
        },
      },
      required: ["target"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { target, style } = input as {
        target: string;
        style?: "formal" | "casual" | "warm";
      };
      const s = style ?? "casual";
      const messages: Record<string, string> = {
        formal: `Buongiorno, ${target}. E' un piacere incontrarla.`,
        casual: `Ciao ${target}! Come va?`,
        warm: `${target}! Che bello vederti, come stai?`,
      };
      return {
        message: messages[s],
        socialEffect: "+trust",
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "argue",
    description:
      "Discuti animatamente con qualcuno su un argomento, sostenendo una posizione precisa.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Persona con cui discutere" },
        topic: { type: "string", description: "Argomento della discussione" },
        position: { type: "string", description: "La tua posizione" },
      },
      required: ["target", "topic", "position"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { target, topic, position } = input as {
        target: string;
        topic: string;
        position: string;
      };
      const intensity = pick("mild", "heated") as "mild" | "heated";
      const effects =
        intensity === "heated"
          ? "-trust, +tension"
          : "neutrale, +rispetto_reciproco";
      return {
        argument: `Hai discusso con ${target} riguardo a "${topic}", sostenendo che ${position}.`,
        intensity,
        socialEffect: effects,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "compliment",
    description:
      "Fai un complimento a qualcuno su un argomento specifico. Rafforza il legame sociale.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Persona a cui fare il complimento",
        },
        subject: {
          type: "string",
          description: "Argomento del complimento",
        },
      },
      required: ["target", "subject"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { target, subject } = input as {
        target: string;
        subject: string;
      };
      return {
        message: `Hai fatto un complimento a ${target} riguardo a ${subject}. Ha apprezzato molto.`,
        socialEffect: "+affinity",
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "insult",
    description:
      "Insulta qualcuno. Azione rischiosa che puo' danneggiare le relazioni sociali.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Persona da insultare" },
        subject: { type: "string", description: "Argomento dell'insulto" },
        severity: {
          type: "string",
          enum: ["mild", "harsh"],
          description: "Gravita' dell'insulto",
        },
      },
      required: ["target", "subject", "severity"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { target, subject, severity } = input as {
        target: string;
        subject: string;
        severity: "mild" | "harsh";
      };
      const risk = severity === "harsh" ? "alto" : "moderato";
      const effect =
        severity === "harsh"
          ? "-trust, -affinity, +hostility"
          : "-affinity, +tension";
      return {
        message: `Hai insultato ${target} riguardo a ${subject}. L'atmosfera si e' fatta tesa.`,
        socialEffect: effect,
        risk,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "ask_question",
    description:
      "Fai una domanda a qualcuno. Stimola la conversazione e dimostra interesse.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Persona a cui fare la domanda",
        },
        question: { type: "string", description: "La domanda da porre" },
      },
      required: ["target", "question"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { target, question } = input as {
        target: string;
        question: string;
      };
      return {
        question: `Hai chiesto a ${target}: "${question}"`,
        expectsResponse: true,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "tell_story",
    description:
      "Racconta una storia su un argomento. Rafforza la coesione del gruppo e intrattiene.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Argomento della storia" },
        audience: {
          type: "string",
          description: "A chi racconti la storia (opzionale)",
        },
      },
      required: ["topic"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { topic, audience } = input as {
        topic: string;
        audience?: string;
      };
      const reactions = [
        "Il pubblico ascolta rapito.",
        "Qualcuno ride, altri annuiscono pensierosi.",
        "Un silenzio attento accompagna le tue parole.",
        "La storia suscita applausi e commenti entusiasti.",
      ];
      const target = audience ? ` a ${audience}` : "";
      return {
        story: `Hai raccontato una storia su "${topic}"${target}. ${pick(...reactions)}`,
        socialEffect: "+group_cohesion",
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "gossip",
    description:
      "Diffondi un pettegolezzo su qualcuno. Puo' essere utile o pericoloso a seconda del contesto.",
    inputSchema: {
      type: "object",
      properties: {
        about: {
          type: "string",
          description: "Persona oggetto del pettegolezzo",
        },
        content: {
          type: "string",
          description: "Contenuto del pettegolezzo",
        },
        target: {
          type: "string",
          description: "Persona a cui racconti il pettegolezzo (opzionale)",
        },
      },
      required: ["about", "content"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { about, content, target } = input as {
        about: string;
        content: string;
        target?: string;
      };
      const spreadRisk = pick("basso", "medio", "alto");
      const dest = target ? ` a ${target}` : " in giro";
      return {
        rumor: `Hai diffuso un pettegolezzo su ${about}${dest}: "${content}"`,
        socialEffect: "+intrigue, -trust_with_subject",
        risk: spreadRisk,
        tick: ctx.tickCount,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/*  physical                                                           */
/* ------------------------------------------------------------------ */

const physicalTools: AgentTool[] = [
  {
    name: "eat",
    description:
      "Mangia qualcosa per recuperare energia. Diversi cibi danno diversi benefici.",
    inputSchema: {
      type: "object",
      properties: {
        food: { type: "string", description: "Cibo da mangiare" },
      },
      required: ["food"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { food } = input as { food: string };
      const energyRestored = randInt(15, 30);
      const satisfactions = [
        "Delizioso!",
        "Soddisfacente.",
        "Niente male.",
        "Un pasto eccellente.",
        "Semplice ma nutriente.",
      ];
      return {
        energyRestored,
        satisfaction: pick(...satisfactions),
        food,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "sleep",
    description:
      "Dormi per un certo numero di ore. Essenziale per recuperare energia e mantenere il buon umore.",
    inputSchema: {
      type: "object",
      properties: {
        hours: { type: "number", description: "Numero di ore di sonno" },
      },
      required: ["hours"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { hours } = input as { hours: number };
      const h = Math.max(1, Math.min(hours, 12));
      return {
        energyRestored: h * 12,
        moodEffect: "calmer",
        hoursSlept: h,
        description: `Hai dormito ${h} ore. Ti senti riposato e piu' sereno.`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "rest",
    description:
      "Riposati brevemente, magari con un'attivita' leggera. Recupera poca energia ma migliora l'umore.",
    inputSchema: {
      type: "object",
      properties: {
        activity: {
          type: "string",
          description: "Attivita' leggera durante il riposo (opzionale)",
        },
      },
      required: [],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { activity } = input as { activity?: string };
      const energyRestored = randInt(5, 10);
      const desc = activity
        ? `Ti sei riposato facendo ${activity}.`
        : "Ti sei seduto e hai riposato un po'.";
      return {
        energyRestored,
        description: desc,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "work",
    description:
      "Lavora su un compito specifico. La durata influisce sul risultato e sull'energia consumata.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Compito da svolgere" },
        duration: {
          type: "string",
          enum: ["short", "medium", "long"],
          description: "Durata del lavoro",
        },
      },
      required: ["task", "duration"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { task, duration } = input as {
        task: string;
        duration: "short" | "medium" | "long";
      };
      const costs: Record<string, number> = {
        short: randInt(5, 10),
        medium: randInt(15, 25),
        long: randInt(30, 45),
      };
      const qualities = ["sufficiente", "buono", "ottimo", "eccellente"];
      return {
        result: `Hai lavorato su "${task}" per una sessione ${duration === "short" ? "breve" : duration === "medium" ? "media" : "lunga"}.`,
        energyCost: costs[duration],
        satisfaction: pick(...qualities),
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "exercise",
    description:
      "Fai esercizio fisico. Costa energia ma migliora la salute e l'umore a lungo termine.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Tipo di esercizio" },
      },
      required: ["type"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { type: exerciseType } = input as { type: string };
      const moods = ["+energico", "+soddisfatto", "+motivato", "+rilassato"];
      return {
        energyCost: 20,
        healthEffect: "+fitness",
        moodEffect: pick(...moods),
        description: `Hai fatto ${exerciseType}. Ti senti meglio!`,
        tick: ctx.tickCount,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/*  farming                                                            */
/* ------------------------------------------------------------------ */

const farmingTools: AgentTool[] = [
  {
    name: "plant",
    description:
      "Pianta un raccolto in un'area specifica. Il risultato dipende dalle condizioni del terreno e dal clima.",
    inputSchema: {
      type: "object",
      properties: {
        crop: { type: "string", description: "Tipo di coltura da piantare" },
        area: { type: "string", description: "Area dove piantare" },
      },
      required: ["crop", "area"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { crop, area } = input as { crop: string; area: string };
      const harvestDays = randInt(30, 90);
      const conditions = pick(
        "ottime",
        "buone",
        "discrete",
        "difficili",
      );
      return {
        planted: true,
        crop,
        area,
        estimatedHarvest: `${harvestDays} giorni`,
        conditions: `Condizioni del terreno: ${conditions}`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "harvest",
    description:
      "Raccogli un raccolto maturo. La quantita' e qualita' dipendono dalle cure prestate.",
    inputSchema: {
      type: "object",
      properties: {
        crop: { type: "string", description: "Coltura da raccogliere" },
      },
      required: ["crop"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { crop } = input as { crop: string };
      const quantity = randInt(10, 100);
      const qualities = ["scarsa", "discreta", "buona", "ottima", "eccellente"];
      return {
        harvested: true,
        crop,
        quantity: `${quantity} kg`,
        quality: pick(...qualities),
        description: `Hai raccolto ${quantity} kg di ${crop}.`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "water_crops",
    description:
      "Irriga le colture in un'area specifica. L'acqua e' essenziale per la crescita.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", description: "Area da irrigare" },
      },
      required: ["area"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { area } = input as { area: string };
      const waterUsed = randInt(50, 200);
      const conditions = pick(
        "ben idratate",
        "in ripresa",
        "rigogliose",
        "assetate",
      );
      return {
        watered: true,
        area,
        waterUsed: `${waterUsed} litri`,
        cropCondition: conditions,
        description: `Hai irrigato ${area}. Le piante appaiono ${conditions}.`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "check_weather",
    description:
      "Controlla le condizioni meteo attuali. Utile per decidere quando seminare o raccogliere.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(_input: unknown, ctx: WorldContext) {
      const temp = randInt(5, 38);
      const conditionsList = [
        "soleggiato",
        "nuvoloso",
        "parzialmente nuvoloso",
        "ventoso",
        "piovoso",
        "nebbioso",
      ];
      const forecasts = [
        "Previsto bel tempo per i prossimi giorni.",
        "Possibili piogge domani.",
        "Temperature in calo nei prossimi giorni.",
        "Settimana stabile e soleggiata.",
        "Rischio temporali nel pomeriggio.",
      ];
      return {
        temperature: `${temp}°C`,
        conditions: pick(...conditionsList),
        forecast: pick(...forecasts),
        rainProbability: `${randInt(0, 100)}%`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "tend_animals",
    description:
      "Prenditi cura degli animali della fattoria. Puoi dar loro da mangiare, mungerli o controllarli.",
    inputSchema: {
      type: "object",
      properties: {
        animal: {
          type: "string",
          description: "Tipo di animale",
        },
        action: {
          type: "string",
          enum: ["feed", "milk", "check"],
          description: "Azione da compiere: dar da mangiare, mungere o controllare",
        },
      },
      required: ["animal", "action"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { animal, action } = input as {
        animal: string;
        action: "feed" | "milk" | "check";
      };
      const actionDescriptions: Record<string, string> = {
        feed: `Hai dato da mangiare a ${animal}. Sembra soddisfatto.`,
        milk: `Hai munto ${animal}. Produzione di ${randFloat(2, 8)} litri.`,
        check: `Hai controllato ${animal}. Condizione: ${pick("sano", "un po' stanco", "in forma", "necessita attenzione")}.`,
      };
      const conditions = pick(
        "in salute",
        "sereno",
        "affamato",
        "energico",
        "tranquillo",
      );
      return {
        result: actionDescriptions[action],
        animalCondition: conditions,
        tick: ctx.tickCount,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/*  technology                                                         */
/* ------------------------------------------------------------------ */

const technologyTools: AgentTool[] = [
  {
    name: "code",
    description:
      "Scrivi codice per un progetto. Simula una sessione di programmazione con possibili bug.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Nome del progetto",
        },
        task: {
          type: "string",
          description: "Compito di programmazione da svolgere",
        },
      },
      required: ["project", "task"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { project, task } = input as {
        project: string;
        task: string;
      };
      const progress = randInt(10, 100);
      const hasBugs = Math.random() < 0.3;
      const result: Record<string, unknown> = {
        result: `Hai lavorato su "${task}" nel progetto ${project}.`,
        progress: `${progress}%`,
        tick: ctx.tickCount,
      };
      if (hasBugs) {
        result.bugsFound = randInt(1, 5);
        result.description = `Trovati ${result.bugsFound} bug durante lo sviluppo. Servira' del debug.`;
      } else {
        result.description =
          "Sessione produttiva, nessun bug critico trovato.";
      }
      return result;
    },
  },
  {
    name: "browse_internet",
    description:
      "Naviga su internet cercando informazioni su un argomento specifico.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Termine di ricerca",
        },
      },
      required: ["query"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { query } = input as { query: string };
      const results = [
        `Articolo: "Guida completa a ${query}"`,
        `Forum: Discussione su ${query} - opinioni varie`,
        `Blog: Esperienza personale con ${query}`,
        `Wikipedia: ${query} - pagina enciclopedica`,
        `Video: Tutorial su ${query}`,
      ];
      const selected = results.slice(0, randInt(2, 5));
      return {
        results: selected,
        summary: `Trovati ${selected.length} risultati rilevanti per "${query}".`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "check_email",
    description:
      "Controlla la posta elettronica. Restituisce un elenco di email simulate.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(_input: unknown, ctx: WorldContext) {
      const senders = [
        "Mario Rossi",
        "Lucia Bianchi",
        "Ufficio Comunale",
        "Newsletter Tecnologia",
        "Giovanni Verdi",
      ];
      const subjects = [
        "Riunione di domani",
        "Proposta di collaborazione",
        "Aggiornamento progetto",
        "Invito evento",
        "Fattura in allegato",
      ];
      const count = randInt(1, 4);
      const emails = Array.from({ length: count }, (_, i) => ({
        from: senders[i % senders.length],
        subject: subjects[i % subjects.length],
        preview: `Anteprima del messaggio da ${senders[i % senders.length]}...`,
      }));
      return {
        emails,
        description: `Hai ${count} email non lette.`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "build_app",
    description:
      "Costruisci un'applicazione o aggiungi una funzionalita'. Simula il processo di sviluppo software.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Nome dell'applicazione",
        },
        feature: {
          type: "string",
          description: "Funzionalita' da implementare",
        },
      },
      required: ["name", "feature"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { name, feature } = input as {
        name: string;
        feature: string;
      };
      const statuses = [
        "in_progress",
        "testing",
        "review",
        "quasi_completato",
      ] as const;
      const nextSteps = [
        "Scrivere i test unitari",
        "Fare code review",
        "Ottimizzare le performance",
        "Aggiornare la documentazione",
        "Deploy in staging",
      ];
      return {
        progress: `${randInt(20, 95)}%`,
        status: pick(...statuses),
        nextStep: pick(...nextSteps),
        description: `Hai lavorato sull'app "${name}", funzionalita': "${feature}".`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "fix_device",
    description:
      "Ripara un dispositivo malfunzionante. Esegue una diagnosi e tenta la riparazione.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Dispositivo da riparare",
        },
        problem: {
          type: "string",
          description: "Descrizione del problema",
        },
      },
      required: ["device", "problem"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { device, problem } = input as {
        device: string;
        problem: string;
      };
      const fixed = Math.random() > 0.2;
      const diagnoses = [
        "Componente usurato, sostituito con successo.",
        "Problema software, risolto con aggiornamento.",
        "Connessione allentata, riparata facilmente.",
        "Danno hardware, necessita pezzo di ricambio.",
        "Surriscaldamento, pulita la ventola.",
      ];
      return {
        fixed,
        device,
        diagnosis: pick(...diagnoses),
        description: fixed
          ? `Hai riparato ${device}. Problema: "${problem}" risolto.`
          : `Non sei riuscito a riparare ${device}. Serve assistenza specializzata.`,
        tick: ctx.tickCount,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/*  spiritual                                                          */
/* ------------------------------------------------------------------ */

const spiritualTools: AgentTool[] = [
  {
    name: "pray",
    description:
      "Prega con un'intenzione specifica o in silenzio. Porta pace interiore e recupera energia spirituale.",
    inputSchema: {
      type: "object",
      properties: {
        intention: {
          type: "string",
          description: "Intenzione della preghiera (opzionale)",
        },
      },
      required: [],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { intention } = input as { intention?: string };
      const experiences = [
        "Un momento di profonda quiete interiore.",
        "Senti una connessione con qualcosa di piu' grande.",
        "Le preoccupazioni si allontanano per un istante.",
        "Un senso di gratitudine pervade il cuore.",
        "La mente si calma e trovi chiarezza.",
      ];
      const desc = intention
        ? `Hai pregato per ${intention}.`
        : "Hai pregato in silenzio.";
      return {
        experience: pick(...experiences),
        moodEffect: "+peace",
        energyEffect: 10,
        description: desc,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "counsel",
    description:
      "Offri consiglio e guida spirituale a una persona su un problema specifico.",
    inputSchema: {
      type: "object",
      properties: {
        person: {
          type: "string",
          description: "Persona a cui offrire consiglio",
        },
        issue: {
          type: "string",
          description: "Problema o questione da affrontare",
        },
      },
      required: ["person", "issue"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { person, issue } = input as {
        person: string;
        issue: string;
      };
      const advices = [
        "Hai ascoltato con empatia e offerto una prospettiva nuova.",
        "Hai condiviso una parabola che ha illuminato la situazione.",
        "Hai suggerito di riflettere con calma prima di agire.",
        "Hai incoraggiato a cercare il bene anche nelle difficolta'.",
      ];
      return {
        advice: pick(...advices),
        socialEffect: "+trust",
        description: `Hai consigliato ${person} riguardo a "${issue}".`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "organize_event",
    description:
      "Organizza un evento comunitario o spirituale. Coinvolge i partecipanti e rafforza la comunita'.",
    inputSchema: {
      type: "object",
      properties: {
        eventType: {
          type: "string",
          description: "Tipo di evento da organizzare",
        },
        participants: {
          type: "array",
          items: { type: "string" },
          description: "Lista dei partecipanti (opzionale)",
        },
      },
      required: ["eventType"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { eventType, participants } = input as {
        eventType: string;
        participants?: string[];
      };
      const estimate = participants
        ? participants.length + randInt(5, 20)
        : randInt(10, 50);
      return {
        planned: true,
        details: `Evento "${eventType}" organizzato con cura.`,
        attendanceEstimate: estimate,
        participants: participants ?? [],
        description: `Hai organizzato un evento di tipo "${eventType}". Partecipanti stimati: ${estimate}.`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "meditate",
    description:
      "Medita per ritrovare la calma e la chiarezza mentale. La durata influisce sull'effetto.",
    inputSchema: {
      type: "object",
      properties: {
        duration: {
          type: "string",
          enum: ["short", "medium", "long"],
          description: "Durata della meditazione",
        },
      },
      required: ["duration"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { duration } = input as {
        duration: "short" | "medium" | "long";
      };
      const clarityLevels: Record<string, string> = {
        short: "leggera chiarezza",
        medium: "buona chiarezza mentale",
        long: "profonda lucidita' e serenita'",
      };
      const durationLabel =
        duration === "short"
          ? "breve"
          : duration === "medium"
            ? "media"
            : "lunga";
      return {
        clarity: clarityLevels[duration],
        moodEffect: "+serene",
        description: `Hai meditato per una sessione ${durationLabel}. ${clarityLevels[duration]}.`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "bless",
    description:
      "Benedici una persona o un'occasione. Gesto di grande significato spirituale e sociale.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Persona o cosa da benedire",
        },
        occasion: {
          type: "string",
          description: "Occasione della benedizione (opzionale)",
        },
      },
      required: ["target"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { target, occasion } = input as {
        target: string;
        occasion?: string;
      };
      const blessings = [
        "Che la pace sia con te.",
        "Che la luce guidi il tuo cammino.",
        "Che la grazia ti accompagni sempre.",
        "Che tu possa trovare cio' che cerchi.",
      ];
      const desc = occasion
        ? `Hai benedetto ${target} per l'occasione: ${occasion}.`
        : `Hai benedetto ${target}.`;
      return {
        blessing: pick(...blessings),
        socialEffect: "+reverence",
        description: desc,
        tick: ctx.tickCount,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/*  academic                                                           */
/* ------------------------------------------------------------------ */

const academicTools: AgentTool[] = [
  {
    name: "study",
    description:
      "Studia un argomento per approfondire le conoscenze. La durata influisce sulla comprensione.",
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Materia o argomento da studiare",
        },
        duration: {
          type: "string",
          enum: ["short", "medium", "long"],
          description: "Durata della sessione di studio",
        },
      },
      required: ["subject", "duration"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { subject, duration } = input as {
        subject: string;
        duration: "short" | "medium" | "long";
      };
      const comprehensionMap: Record<string, string> = {
        short: pick("superficiale", "basilare"),
        medium: pick("buona", "discreta"),
        long: pick("approfondita", "eccellente"),
      };
      const energyCosts: Record<string, number> = {
        short: randInt(5, 10),
        medium: randInt(15, 25),
        long: randInt(30, 40),
      };
      const durationLabel =
        duration === "short"
          ? "breve"
          : duration === "medium"
            ? "media"
            : "lunga";
      return {
        learned: `Hai studiato "${subject}" in una sessione ${durationLabel}.`,
        comprehension: comprehensionMap[duration],
        energyCost: energyCosts[duration],
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "research",
    description:
      "Conduci una ricerca su un argomento usando un metodo specifico: letteratura, sperimentale o sondaggio.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Argomento della ricerca",
        },
        method: {
          type: "string",
          enum: ["literature", "experimental", "survey"],
          description: "Metodo di ricerca",
        },
      },
      required: ["topic", "method"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { topic, method } = input as {
        topic: string;
        method: "literature" | "experimental" | "survey";
      };
      const methodLabels: Record<string, string> = {
        literature: "revisione della letteratura",
        experimental: "metodo sperimentale",
        survey: "indagine tramite sondaggio",
      };
      const significances = [
        "marginale",
        "interessante",
        "significativa",
        "molto rilevante",
        "potenzialmente rivoluzionaria",
      ];
      const findings = [
        `Emergono nuove connessioni tra ${topic} e fenomeni correlati.`,
        `I dati confermano l'ipotesi iniziale su ${topic}.`,
        `Risultati contrastanti richiedono ulteriori approfondimenti su ${topic}.`,
        `Scoperta una tendenza inaspettata nello studio di ${topic}.`,
      ];
      return {
        findings: pick(...findings),
        significance: pick(...significances),
        method: methodLabels[method],
        description: `Ricerca su "${topic}" condotta con ${methodLabels[method]}.`,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "take_notes",
    description:
      "Prendi appunti su un argomento. Utile per organizzare le idee e ricordare informazioni importanti.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Contenuto degli appunti",
        },
        category: {
          type: "string",
          description: "Categoria degli appunti (opzionale)",
        },
      },
      required: ["content"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { content, category } = input as {
        content: string;
        category?: string;
      };
      const cat = category ?? "generale";
      const words = content.split(/\s+/).length;
      return {
        saved: true,
        summary: `Appunti salvati (${words} parole, categoria: ${cat}).`,
        category: cat,
        tick: ctx.tickCount,
      };
    },
  },
  {
    name: "present_findings",
    description:
      "Presenta i risultati di una ricerca o studio a un pubblico. Genera reazioni e domande.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Argomento della presentazione",
        },
        audience: {
          type: "string",
          description: "Pubblico a cui presenti",
        },
      },
      required: ["topic", "audience"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const { topic, audience } = input as {
        topic: string;
        audience: string;
      };
      const reactions = [
        "Il pubblico applaude con entusiasmo.",
        "Reazione mista: alcuni convinti, altri scettici.",
        "Grande interesse, molte domande dal pubblico.",
        "Accoglienza positiva e richiesta di approfondimenti.",
        "Standing ovation! La presentazione ha colpito nel segno.",
      ];
      const questionPool = [
        `Come hai raccolto i dati su ${topic}?`,
        "Quali sono le implicazioni pratiche?",
        "Hai considerato approcci alternativi?",
        "Puoi approfondire la metodologia?",
        `Come si collega ${topic} alla ricerca precedente?`,
        "Quali sono i limiti dello studio?",
      ];
      const numQuestions = randInt(1, 3);
      const questions: string[] = [];
      const available = [...questionPool];
      for (let i = 0; i < numQuestions && available.length > 0; i++) {
        const idx = Math.floor(Math.random() * available.length);
        questions.push(available.splice(idx, 1)[0] as string);
      }
      return {
        reaction: pick(...reactions),
        questions,
        socialEffect: "+academic_standing",
        description: `Hai presentato "${topic}" a ${audience}.`,
        tick: ctx.tickCount,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/*  cooking (placeholder — no tools specified in prompt, but category  */
/*  exists in the type)                                                */
/* ------------------------------------------------------------------ */

const cookingTools: AgentTool[] = [];

/* ------------------------------------------------------------------ */
/*  crafting (placeholder — no tools specified in prompt, but category */
/*  exists in the type)                                                */
/* ------------------------------------------------------------------ */

const craftingTools: AgentTool[] = [];

/* ------------------------------------------------------------------ */
/*  Skill-tools map                                                    */
/* ------------------------------------------------------------------ */

const SKILL_TOOLS: Record<SkillCategory, AgentTool[]> = {
  movement: movementTools,
  social: socialTools,
  physical: physicalTools,
  farming: farmingTools,
  technology: technologyTools,
  spiritual: spiritualTools,
  academic: academicTools,
  cooking: cookingTools,
  crafting: craftingTools,
};

/* ------------------------------------------------------------------ */
/*  Plugin class                                                       */
/* ------------------------------------------------------------------ */

export class LifeSkillsPlugin implements WorldSimPlugin {
  readonly name = "life-skills";
  readonly version = "1.0.0";
  readonly parallel = true;

  private _tools: AgentTool[];

  constructor(categories?: SkillCategory[]) {
    const cats =
      categories ?? (Object.keys(SKILL_TOOLS) as SkillCategory[]);
    this._tools = cats.flatMap((c) => SKILL_TOOLS[c] ?? []);
  }

  get tools(): AgentTool[] {
    return this._tools;
  }

  static getToolsForSkills(skills: SkillCategory[]): AgentTool[] {
    return skills.flatMap((s) => SKILL_TOOLS[s] ?? []);
  }

  static getToolNamesForSkills(skills: SkillCategory[]): string[] {
    return skills.flatMap((s) => (SKILL_TOOLS[s] ?? []).map((t) => t.name));
  }
}
