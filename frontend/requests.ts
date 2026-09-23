import type { components } from "./api.generated";
export type SearchRequest = components["schemas"]["SearchInput"];
export function searchRequest(
  query: string,
  topicIds: string[],
  topicMode: string,
  sourceIds: string[],
  cloud: boolean,
): SearchRequest {
  return {
    query,
    topic_ids: topicIds,
    topic_mode: topicMode === "all" ? "all" : "any",
    source_ids: sourceIds,
    limit: 12,
    cloud,
    authorized: cloud,
  };
}
