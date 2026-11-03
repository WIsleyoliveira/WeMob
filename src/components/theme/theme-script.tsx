/**
 * Aplica o tema antes da primeira pintura (sem "piscar" claro → escuro): lê a preferência do cookie `sm_theme`
 * (light | dark | system; padrão system) e o tema do sistema operacional. Script inline curto e sem dados do usuário.
 */
export const THEME_COOKIE = "sm_theme";

const code = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)/);var p=m?m[1]:"system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.dataset.themePref=p;}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
