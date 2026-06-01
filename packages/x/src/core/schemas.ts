// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

export const AuthorSchema = z.object({
  username: z.string(),
  name: z.string(),
});

export type Author = z.infer<typeof AuthorSchema>;

export const TweetSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    text: z.string(),
    author: AuthorSchema,
    author_id: z.string().optional(),
    created_at: z.string().optional(),
    reply_count: z.number().default(0),
    retweet_count: z.number().default(0),
    like_count: z.number().default(0),
    quote_count: z.number().default(0),
    view_count: z.number().optional(),
    conversation_id: z.string().optional(),
    in_reply_to_status_id: z.string().optional(),
    lang: z.string().optional(),
    is_note_tweet: z.boolean().default(false),
    quoted_tweet: z.nullable(z.lazy(() => TweetSchema)).optional(),
    media: z.array(z.any()).optional(),
  })
);

export type Tweet = z.infer<typeof TweetSchema>;

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  description: z.string().optional(),
  followers_count: z.number().optional(),
  following_count: z.number().optional(),
  is_blue_verified: z.boolean().optional(),
  profile_image_url: z.string().optional(),
  created_at: z.string().optional(),
});

export type User = z.infer<typeof UserSchema>;

export const ListInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  member_count: z.number().optional(),
  subscriber_count: z.number().optional(),
  mode: z.string().optional(),
});

export type ListInfo = z.infer<typeof ListInfoSchema>;
