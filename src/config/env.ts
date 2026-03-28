import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: Number(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  renderProjectId: process.env.RENDER_PROJECT_ID || '',
  renderEnvironmentId: process.env.RENDER_ENVIRONMENT_ID || '',
  supabaseProjectRef: process.env.SUPABASE_PROJECT_REF || '',
  supabaseDbPassword: process.env.SUPABASE_DB_PASSWORD || '',
  adminWriteToken: process.env.ADMIN_WRITE_TOKEN || '',
  get databaseUrl(): string {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    if (this.supabaseProjectRef && this.supabaseDbPassword) {
      return `postgresql://postgres:${encodeURIComponent(this.supabaseDbPassword)}@db.${this.supabaseProjectRef}.supabase.co:5432/postgres`;
    }
    return '';
  },
  get hasDatabaseConfig(): boolean {
    return Boolean(this.databaseUrl);
  }
};

export function assertLaunchEnv() {
  return {
    hasOpenAI: Boolean(env.openAiApiKey),
    hasDatabaseConfig: env.hasDatabaseConfig,
    renderProjectId: env.renderProjectId,
    renderEnvironmentId: env.renderEnvironmentId,
    supabaseProjectRef: env.supabaseProjectRef
  };
}
