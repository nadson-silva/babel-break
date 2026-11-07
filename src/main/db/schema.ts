import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const profiles = sqliteTable('profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  targetLang: text('target_lang').notNull().default('en'),
  nativeLang: text('native_lang').notNull().default('pt-BR'),
  goal: text('goal'),
  cefr: text('cefr'),
  focusMix: real('focus_mix').notNull().default(0.3),
  prefs: text('prefs'),
  onboardingCompletedAt: integer('onboarding_completed_at'),
  placementScore: real('placement_score'),
  createdAt: integer('created_at').notNull()
})

export const skillsState = sqliteTable(
  'skills_state',
  {
    profileId: integer('profile_id').notNull(),
    skill: text('skill').notNull(),
    estimate: real('estimate').notNull().default(0),
    confidence: real('confidence').notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.profileId, t.skill] })]
)

export const languages = sqliteTable('languages', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  scriptDirection: text('script_direction').notNull().default('ltr'),
  tokenization: text('tokenization').notNull().default('space'),
  promptNotes: text('prompt_notes')
})

export const units = sqliteTable('units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  level: text('level').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull()
})

export const lessons = sqliteTable('lessons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  unitId: integer('unit_id'),
  trackId: integer('track_id'),
  title: text('title').notNull(),
  objective: text('objective'),
  level: text('level').notNull(),
  content: text('content'),
  scenario: text('scenario'),
  position: integer('position').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull()
})

export const lessonItems = sqliteTable('lesson_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lessonId: integer('lesson_id').notNull(),
  kind: text('kind').notNull(),
  payload: text('payload').notNull()
})

export const exercises = sqliteTable('exercises', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lessonId: integer('lesson_id').notNull(),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  answerKey: text('answer_key').notNull(),
  source: text('source'),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull()
})

export const attempts = sqliteTable('attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  exerciseId: integer('exercise_id').notNull(),
  response: text('response').notNull(),
  correct: integer('correct', { mode: 'boolean' }).notNull(),
  score: real('score'),
  latencyMs: integer('latency_ms'),
  createdAt: integer('created_at').notNull()
})

export const errors = sqliteTable('errors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull(),
  category: text('category').notNull(),
  tag: text('tag').notNull(),
  original: text('original').notNull(),
  corrected: text('corrected').notNull(),
  context: text('context'),
  resolvedAt: integer('resolved_at'),
  createdAt: integer('created_at').notNull()
})

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull(),
  content: text('content').notNull(),
  stability: real('stability'),
  difficulty: real('difficulty'),
  due: integer('due').notNull(),
  reps: integer('reps').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  state: text('state').notNull().default('new'),
  createdAt: integer('created_at').notNull()
})

export const reviews = sqliteTable('reviews', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull(),
  rating: integer('rating').notNull(),
  reviewedAt: integer('reviewed_at').notNull()
})

export const lessonProgress = sqliteTable(
  'lesson_progress',
  {
    profileId: integer('profile_id').notNull(),
    lessonId: integer('lesson_id').notNull(),
    status: text('status').notNull().default('not_started'),
    lastOpenedAt: integer('last_opened_at'),
    score: real('score')
  },
  (t) => [primaryKey({ columns: [t.profileId, t.lessonId] })]
)

export const studySessions = sqliteTable('study_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull(),
  kind: text('kind').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  summary: text('summary')
})

export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull(),
  lessonId: integer('lesson_id'),
  mode: text('mode').notNull().default('free'),
  topic: text('topic'),
  scenario: text('scenario'),
  summary: text('summary'),
  createdAt: integer('created_at').notNull()
})

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: integer('conversation_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull()
})

export const focusTracks = sqliteTable('focus_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull(),
  title: text('title').notNull(),
  goalTag: text('goal_tag'),
  levelRange: text('level_range'),
  status: text('status').notNull().default('draft'),
  source: text('source').notNull().default('user'),
  createdAt: integer('created_at').notNull()
})

export const trackLessons = sqliteTable(
  'track_lessons',
  {
    trackId: integer('track_id').notNull(),
    lessonId: integer('lesson_id').notNull(),
    position: integer('position').notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.trackId, t.lessonId] })]
)

export const scenarioRuns = sqliteTable('scenario_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lessonId: integer('lesson_id'),
  conversationId: integer('conversation_id').notNull(),
  contentScore: real('content_score'),
  languageScore: real('language_score'),
  feedback: text('feedback'),
  createdAt: integer('created_at').notNull()
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export type Profile = typeof profiles.$inferSelect
export type Setting = typeof settings.$inferSelect
