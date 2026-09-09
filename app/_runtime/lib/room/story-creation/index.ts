/** The sole Story Creation Interface. Context, recipe and call capabilities
 * are supplied by the trusted host; results are private preparation materials,
 * never world writes or directly publishable player text. */
export { prepareStory } from "./authoring";
export { createStoryRecipes } from "./recipes";
export { STORY_CREATION_WORKFLOW, STORY_CREATION_WORKFLOW_REF } from "./prompt";
export { storyReviewAllowsRevision, storyReviewPassed } from "./review";
export type { StoryCapabilityDescription } from "./review";
export type * from "./contracts";
