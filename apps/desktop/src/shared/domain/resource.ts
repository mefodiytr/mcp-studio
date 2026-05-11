import { z } from 'zod';

/** A resource as advertised by `resources/list`, trimmed for the browser UI. */
export const resourceDescriptorSchema = z
  .object({
    uri: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  })
  .passthrough();
export type ResourceDescriptor = z.infer<typeof resourceDescriptorSchema>;

/** A resource template as advertised by `resources/templates/list`. */
export const resourceTemplateDescriptorSchema = z
  .object({
    uriTemplate: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .passthrough();
export type ResourceTemplateDescriptor = z.infer<typeof resourceTemplateDescriptorSchema>;

/** One block of a `resources/read` result — text or base64 blob. */
export const resourceContentSchema = z
  .object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
  })
  .passthrough();
export type ResourceContent = z.infer<typeof resourceContentSchema>;

export const readResourceResultSchema = z
  .object({ contents: z.array(resourceContentSchema) })
  .passthrough();
export type ReadResourceResult = z.infer<typeof readResourceResultSchema>;
