import type { WorldSimPlugin, AgentTool } from "../../types/PluginTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

export interface WeatherDataSource {
  provider: "open-meteo";
  latitude: number;
  longitude: number;
  description?: string;
}

export interface NewsDataSource {
  provider: "rss";
  feeds: string[];
}

export interface EnvironmentDataSource {
  waterLevel?: "derived-from-weather" | "static";
  cropStatus?: "derived-from-weather" | "static";
}

export interface RealWorldDataSources {
  weather?: WeatherDataSource | undefined;
  news?: NewsDataSource | undefined;
  environment?: EnvironmentDataSource | undefined;
}

export interface RealWorldToolsOptions {
  dataSources?: RealWorldDataSources | undefined;
}

/* ------------------------------------------------------------------ */
/*  Weather cache                                                      */
/* ------------------------------------------------------------------ */

interface WeatherData {
  temperature: number;
  apparentTemperature: number;
  precipitationMm: number;
  humidity: number;
  windSpeed: number;
  weatherDescription: string;
  forecastDays: { date: string; maxTemp: number; minTemp: number; precipMm: number }[];
  fetchedAt: number;
}

let weatherCache: WeatherData | null = null;
const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function weatherCodeToDescription(code: number): string {
  if (code === 0) return "cielo sereno";
  if (code <= 3) return "parzialmente nuvoloso";
  if (code <= 48) return "nebbia";
  if (code <= 55) return "pioggia leggera";
  if (code <= 65) return "pioggia";
  if (code <= 67) return "pioggia gelata";
  if (code <= 77) return "neve";
  if (code <= 82) return "acquazzoni";
  if (code <= 86) return "neve forte";
  if (code >= 95) return "temporale";
  return "variabile";
}

async function fetchWeather(source: WeatherDataSource): Promise<WeatherData> {
  if (weatherCache && Date.now() - weatherCache.fetchedAt < WEATHER_CACHE_TTL_MS) {
    return weatherCache;
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${source.latitude}&longitude=${source.longitude}&current=temperature_2m,apparent_temperature,precipitation,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=7`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status}`);
  }

  const data = await res.json() as {
    current: {
      temperature_2m: number;
      apparent_temperature: number;
      precipitation: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      weather_code: number;
    };
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
    };
  };

  const forecastDays = data.daily.time.map((date, i) => ({
    date,
    maxTemp: data.daily.temperature_2m_max[i] ?? 0,
    minTemp: data.daily.temperature_2m_min[i] ?? 0,
    precipMm: data.daily.precipitation_sum[i] ?? 0,
  }));

  weatherCache = {
    temperature: data.current.temperature_2m,
    apparentTemperature: data.current.apparent_temperature,
    precipitationMm: data.current.precipitation,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    weatherDescription: weatherCodeToDescription(data.current.weather_code),
    forecastDays,
    fetchedAt: Date.now(),
  };

  return weatherCache;
}

/* ------------------------------------------------------------------ */
/*  Environment derived from weather                                   */
/* ------------------------------------------------------------------ */

function deriveEnvironment(weather: WeatherData): {
  waterLevel: string;
  waterLevelPercent: number;
  cropStatus: string;
  riverFlow: string;
  soilMoisture: string;
} {
  const totalPrecip7d = weather.forecastDays.reduce((s, d) => s + d.precipMm, 0);
  const avgTemp = weather.forecastDays.reduce((s, d) => s + d.maxTemp, 0) / weather.forecastDays.length;

  // Water level: less rain + higher temps = lower water
  let waterPercent = Math.max(5, Math.min(100, 40 + totalPrecip7d * 3 - Math.max(0, avgTemp - 25) * 5));
  waterPercent = Math.round(waterPercent);

  let waterLevel: string;
  if (waterPercent > 70) waterLevel = "normale";
  else if (waterPercent > 40) waterLevel = "sotto la media";
  else if (waterPercent > 20) waterLevel = "basso, preoccupante";
  else waterLevel = "critico, quasi secco";

  let cropStatus: string;
  if (totalPrecip7d > 20 && avgTemp < 35) cropStatus = "buono, i raccolti crescono bene";
  else if (totalPrecip7d > 5) cropStatus = "discreto, ma serve più acqua";
  else if (avgTemp > 30) cropStatus = "sofferente, le piante mostrano segni di stress idrico";
  else cropStatus = "a rischio, senza pioggia i raccolti moriranno";

  let riverFlow: string;
  if (totalPrecip7d > 30) riverFlow = "forte, il fiume scorre abbondante";
  else if (totalPrecip7d > 10) riverFlow = "normale";
  else if (totalPrecip7d > 2) riverFlow = "debole, il livello è visibilmente calato";
  else riverFlow = "minimo, si vedono le rocce del fondo";

  let soilMoisture: string;
  if (totalPrecip7d > 15 && avgTemp < 30) soilMoisture = "umido, la terra è morbida";
  else if (totalPrecip7d > 5) soilMoisture = "asciutto in superficie, umido in profondità";
  else soilMoisture = "secco e screpolato, la terra è dura";

  return { waterLevel, waterLevelPercent: waterPercent, cropStatus, riverFlow, soilMoisture };
}

/* ------------------------------------------------------------------ */
/*  Tools                                                              */
/* ------------------------------------------------------------------ */

function buildTools(options: RealWorldToolsOptions): AgentTool[] {
  const tools: AgentTool[] = [];
  const dataSources = options.dataSources ?? {};

  // ── check_weather ──────────────────────────────────────────────
  if (dataSources.weather) {
    const weatherSource = dataSources.weather;
    tools.push({
      name: "check_weather",
      description:
        "Controlla le previsioni meteo della zona. Restituisce temperatura attuale, condizioni e previsioni per i prossimi 7 giorni. Utile per capire se ci sarà siccità, pioggia, caldo estremo.",
      inputSchema: {
        type: "object",
        properties: {
          detail: {
            type: "string",
            enum: ["current", "forecast", "full"],
            description: "Livello di dettaglio: 'current' (solo ora), 'forecast' (prossimi giorni), 'full' (tutto)",
          },
        },
        required: [],
      },
      async execute(input: unknown, _ctx: WorldContext) {
        const { detail } = input as { detail?: string };
        try {
          const weather = await fetchWeather(weatherSource);

          if (detail === "current") {
            return {
              temperatura: `${weather.temperature}°C`,
              percepita: `${weather.apparentTemperature}°C`,
              condizioni: weather.weatherDescription,
              precipitazioni: `${weather.precipitationMm}mm`,
              umidità: `${weather.humidity}%`,
              vento: `${weather.windSpeed}km/h`,
              zona: weatherSource.description ?? `${weatherSource.latitude}, ${weatherSource.longitude}`,
            };
          }

          if (detail === "forecast") {
            return {
              previsioni: weather.forecastDays.map((d) => ({
                data: d.date,
                max: `${d.maxTemp}°C`,
                min: `${d.minTemp}°C`,
                pioggia: `${d.precipMm}mm`,
              })),
              pioggiaTotale7giorni: `${weather.forecastDays.reduce((s, d) => s + d.precipMm, 0).toFixed(1)}mm`,
            };
          }

          // full
          const totalPrecip = weather.forecastDays.reduce((s, d) => s + d.precipMm, 0);
          return {
            attuale: {
              temperatura: `${weather.temperature}°C`,
              condizioni: weather.weatherDescription,
              precipitazioni: `${weather.precipitationMm}mm`,
              umidità: `${weather.humidity}%`,
            },
            previsioni7giorni: weather.forecastDays.map((d) => ({
              data: d.date,
              max: `${d.maxTemp}°C`,
              min: `${d.minTemp}°C`,
              pioggia: `${d.precipMm}mm`,
            })),
            riepilogo: totalPrecip < 5
              ? "ATTENZIONE: Quasi nessuna pioggia prevista nei prossimi 7 giorni. Rischio siccità."
              : totalPrecip < 15
                ? "Pioggia scarsa prevista. Situazione da monitorare."
                : "Pioggia adeguata prevista per i prossimi giorni.",
          };
        } catch (err) {
          return { errore: `Impossibile ottenere dati meteo: ${(err as Error).message}` };
        }
      },
    });
  }

  // ── read_news ──────────────────────────────────────────────────
  if (dataSources.news) {
    const newsSource = dataSources.news;
    tools.push({
      name: "read_news",
      description:
        "Legge le ultime notizie dai feed locali. Restituisce i titoli e i riassunti delle notizie più recenti. Utile per un giornalista che vuole informare la comunità.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Argomento specifico da cercare nelle notizie (opzionale)",
          },
          limit: {
            type: "number",
            description: "Numero massimo di notizie da restituire (default 5)",
          },
        },
        required: [],
      },
      async execute(input: unknown, _ctx: WorldContext) {
        const { query, limit } = input as { query?: string; limit?: number };
        const maxItems = limit ?? 5;

        const allItems: { title: string; description: string; source: string }[] = [];

        for (const feedUrl of newsSource.feeds) {
          try {
            const res = await fetch(feedUrl);
            if (!res.ok) continue;
            const text = await res.text();

            // Simple RSS XML parsing (no external dependency)
            const items = text.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
            for (const item of items.slice(0, maxItems)) {
              const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/)?.[1] ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
              const desc = item.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/)?.[1] ?? item.match(/<description>(.*?)<\/description>/)?.[1] ?? "";
              allItems.push({
                title: title.replace(/<[^>]*>/g, "").trim(),
                description: desc.replace(/<[^>]*>/g, "").trim().slice(0, 200),
                source: feedUrl,
              });
            }
          } catch {
            // Skip failed feeds
          }
        }

        let filtered = allItems;
        if (query) {
          const q = query.toLowerCase();
          filtered = allItems.filter(
            (item) => item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
          );
        }

        return {
          notizie: filtered.slice(0, maxItems),
          totale: filtered.length,
          nota: filtered.length === 0 ? "Nessuna notizia trovata per questa ricerca." : undefined,
        };
      },
    });
  }

  // ── observe_environment ────────────────────────────────────────
  if (dataSources.weather || dataSources.environment) {
    const weatherSource = dataSources.weather;
    tools.push({
      name: "observe_environment",
      description:
        "Osserva le condizioni ambientali locali: livello dell'acqua nel pozzo, stato dei raccolti, flusso del fiume, umidità del terreno. Dati basati sulle condizioni meteo reali della zona.",
      inputSchema: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            enum: ["acqua", "raccolti", "fiume", "terreno", "tutto"],
            description: "Cosa osservare: 'acqua' (livello pozzo), 'raccolti' (stato piante), 'fiume', 'terreno', 'tutto'",
          },
        },
        required: [],
      },
      async execute(input: unknown, _ctx: WorldContext) {
        const { focus } = input as { focus?: string };

        let weather: WeatherData;
        try {
          if (weatherSource) {
            weather = await fetchWeather(weatherSource);
          } else {
            // Fallback: simulate average conditions
            weather = {
              temperature: 28,
              apparentTemperature: 30,
              precipitationMm: 0,
              humidity: 45,
              windSpeed: 10,
              weatherDescription: "soleggiato",
              forecastDays: Array.from({ length: 7 }, (_, i) => ({
                date: new Date(Date.now() + i * 86400000).toISOString().slice(0, 10),
                maxTemp: 32,
                minTemp: 18,
                precipMm: 0,
              })),
              fetchedAt: Date.now(),
            };
          }
        } catch {
          return { errore: "Impossibile osservare l'ambiente in questo momento." };
        }

        const env = deriveEnvironment(weather);

        if (focus === "acqua") {
          return { livelloAcqua: env.waterLevel, percentuale: `${env.waterLevelPercent}%` };
        }
        if (focus === "raccolti") {
          return { statoRaccolti: env.cropStatus };
        }
        if (focus === "fiume") {
          return { flussoFiume: env.riverFlow };
        }
        if (focus === "terreno") {
          return { umiditàTerreno: env.soilMoisture };
        }

        // tutto
        return {
          livelloAcqua: env.waterLevel,
          percentualeAcqua: `${env.waterLevelPercent}%`,
          statoRaccolti: env.cropStatus,
          flussoFiume: env.riverFlow,
          umiditàTerreno: env.soilMoisture,
          temperaturaAttuale: `${weather.temperature}°C`,
          condizioni: weather.weatherDescription,
        };
      },
    });
  }

  return tools;
}

/* ------------------------------------------------------------------ */
/*  Plugin                                                             */
/* ------------------------------------------------------------------ */

export class RealWorldToolsPlugin implements WorldSimPlugin {
  readonly name = "real-world-tools";
  readonly version = "1.0.0";
  readonly parallel = true;

  private _tools: AgentTool[];

  constructor(options?: RealWorldToolsOptions) {
    this._tools = buildTools(options ?? {});
  }

  get tools(): AgentTool[] {
    return this._tools;
  }
}
