import { z } from "zod";

/** Mensagens padrão de validação em português (Zod 4). Importado onde erros de validação chegam à tela. */
z.config(z.locales.pt());
