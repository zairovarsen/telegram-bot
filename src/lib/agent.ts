import { analyzeTaskPrompt, createTasksPrompt, executeTaskPrompt, startGoalPrompt, summarizeSearchSnippets } from "@/utils/prompt";
import { llm } from "./model";
import { LLMChain } from "langchain";
import { extractTasks } from "@/utils/task";
import { Analysis, SearchResult } from "@/types";

  async function callSerper(input: string) {
    const options = {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERP_API_KEY as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: input,
      }),
    };

    const res = await fetch("https://google.serper.dev/search", options);

    if (!res.ok) {
      console.error(`Got ${res.status} error from serper: ${res.statusText}`);
    }

    return res;
  }

export async function startGoalAgent({goal, language='English'} : {
    goal: string;
    language?: string;
}): Promise<string[]> {

  const completion = await new LLMChain({
    llm: llm ,
    prompt: startGoalPrompt,
  }).call({
    goal,
    language
  });
  console.log("Goal", goal, "Completion:" + (completion.text as string));
  return extractTasks(completion.text as string, []);
}


export async function analyzeTaskAgent(
  goal: string,
  task: string
) {
  const actions = ["reason", "search"];
  const completion = await new LLMChain({
    llm,
    prompt: analyzeTaskPrompt,
  }).call({
    goal,
    actions,
    task,
  });

  console.log("Analysis completion:\n", completion.text);
  try {
    return JSON.parse(completion.text) as Analysis;
  } catch (e) {
    console.error("Error parsing analysis", e);
    // Default to reasoning
    return DefaultAnalysis;
  }
}

export const DefaultAnalysis: Analysis = {
  action: "reason",
  arg: "Fallback due to parsing failure",
};


export async function executeTaskAgent(
  goal: string,
  language: string,
  task: string,
  analysis: Analysis
): Promise<string | null> {
  console.log("Execution analysis:", analysis);

  if (analysis.action == "search" && process.env.SERP_API_KEY) {
    // serp related stuff 
        const res = await callSerper(analysis.arg);
        const searchResult: SearchResult = (await res.json()) as SearchResult;

         // Link means it is a snippet from a website and should not be viewed as a final answer
    if (searchResult.answerBox && !searchResult.answerBox.link) {
      const answerValues: string[] = [];
      if (searchResult.answerBox.title) {
        answerValues.push(searchResult.answerBox.title);
      }

      if (searchResult.answerBox.answer) {
        answerValues.push(searchResult.answerBox.answer);
      }

      if (searchResult.answerBox.snippet) {
        answerValues.push(searchResult.answerBox.snippet);
      }

      return answerValues.join("\n");
    }

    if (searchResult.sportsResults?.game_spotlight) {
      return searchResult.sportsResults.game_spotlight;
    }

    if (searchResult.knowledgeGraph?.description) {
      // TODO: use Title description, attributes
      return searchResult.knowledgeGraph.description;
    }

    if (searchResult.organic?.[0]?.snippet) {
      const snippets = searchResult.organic.map((result) => result.snippet);
      const summary = await summarizeSnippets(
        goal,
        analysis.arg,
        snippets
      );
      const resultsToLink = searchResult.organic.slice(0, 3);
      const links = resultsToLink.map((result) => result.link);

      return `${summary}\n\nLinks:\n${links
        .map((link) => `- ${link}`)
        .join("\n")}`;
    }

    return null;
  }

  const completion = await new LLMChain({
    llm,
    prompt: executeTaskPrompt,
  }).call({
    goal,
    language,
    task,
  });

  // For local development when no SERP API Key provided
  if (analysis.action == "search" && !process.env.SERP_API_KEY) {
    console.error(`\`ERROR: Failed to search as no SERP_API_KEY is provided in ENV.\` \n\n${
      completion.text as string
    }`);
    return null;
  }

  return completion.text as string;
}

export async function createTasksAgent(
    {
    goal,
    language,
    tasks,
    lastTask,
    result,
    completedTasks,
    }:
    {
  goal: string,
  language: string,
  tasks: string[],
  lastTask: string,
  result: string,
  completedTasks: string[] | undefined
    }
) {
  const completion = await new LLMChain({
    llm,
    prompt: createTasksPrompt,
  }).call({
    goal,
    language,
    tasks,
    lastTask,
    result,
  });

  return extractTasks(completion.text as string, completedTasks || []);
}

const summarizeSnippets = async (
  goal: string,
  query: string,
  snippets: string[]
) => {
  const completion = await new LLMChain({
    llm: llm,
    prompt: summarizeSearchSnippets,
  }).call({
    goal,
    query,
    snippets,
  });
  return completion.text as string;
};