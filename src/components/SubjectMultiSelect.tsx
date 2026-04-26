import { Check, Plus } from "lucide-react";
import { useState, KeyboardEvent, forwardRef } from "react";
import { SUBJECT_OPTIONS } from "@/lib/subjects";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

/**
 * Compact multi-select for tutor subjects. Click chip to toggle.
 * Allows adding custom subjects via inline input.
 */
export const SubjectMultiSelect = forwardRef<HTMLDivElement, Props>(
  function SubjectMultiSelect({ value, onChange, className }, ref) {
    const [custom, setCustom] = useState("");

    const toggle = (s: string) => {
      if (value.includes(s)) onChange(value.filter((v) => v !== s));
      else onChange([...value, s]);
    };

    const addCustom = () => {
      const trimmed = custom.trim();
      if (!trimmed) return;
      if (!value.