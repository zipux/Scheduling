"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FieldError } from "@/components/app/field-error";

export function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
  hint?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        value={props.value}
        aria-invalid={props.errors ? true : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <p className="text-xs text-muted-foreground">{props.hint}</p>}
      <FieldError errors={props.errors} />
    </div>
  );
}

export function SwitchField(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; errors?: string[] }) {
  return (
    <div>
      <label className="flex min-h-11 items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-medium">{props.label}</span>
          {props.hint && <span className="block text-xs text-muted-foreground">{props.hint}</span>}
        </span>
        <Switch checked={props.checked} onCheckedChange={(c) => props.onChange(!!c)} aria-label={props.label} />
      </label>
      <FieldError errors={props.errors} />
    </div>
  );
}
