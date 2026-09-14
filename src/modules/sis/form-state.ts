/** Shared shape returned by every SIS server action used with useActionState. */
export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      success?: string;
    }
  | undefined;
