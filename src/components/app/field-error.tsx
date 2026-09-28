export function FieldError({ errors, id }: { errors?: string[]; id?: string }) {
  if (!errors?.length) return null;
  return (
    <p id={id} className="text-sm text-destructive" role="alert">
      {errors.join(" ")}
    </p>
  );
}
