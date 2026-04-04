interface Props {
  fieldKey: string;
  requiredFields: string[];
}

export function RequiredIndicator({ fieldKey, requiredFields }: Props) {
  if (!requiredFields.includes(fieldKey)) return null;
  return <span className="text-destructive ml-0.5">*</span>;
}
