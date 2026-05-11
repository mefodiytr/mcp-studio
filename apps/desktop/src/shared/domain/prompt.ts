import { z } from 'zod';

import { contentBlockSchema } from './tool-result';

/** One declared argument of a prompt (`prompts/list` → `Prompt.arguments`). */
export const promptArgumentSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
  })
  .passthrough();
export type PromptArgument = z.infer<typeof promptArgumentSchema>;

/** A prompt as advertised by `prompts/list`, trimmed for the library UI. */
export const promptDescriptorSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    arguments: z.array(promptArgumentSchema).optional(),
  })
  .passthrough();
export type PromptDescriptor = z.infer<typeof promptDescriptorSchema>;

/** One message of an assembled prompt (`prompts/get` → `messages[]`). */
export const promptMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: contentBlockSchema,
  })
  .passthrough();
export type PromptMessage = z.infer<typeof promptMessageSchema>;

export const getPromptResultSchema = z
  .object({
    description: z.string().optional(),
    messages: z.array(promptMessageSchema),
  })
  .passthrough();
export type GetPromptResult = z.infer<typeof getPromptResultSchema>;
