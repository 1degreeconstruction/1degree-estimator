import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin } from "lucide-react";

interface AddressComponents {
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface Prediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelect: (components: AddressComponents) => void;
  placeholder?: string;
  id?: string;
  "data-testid"?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function AddressAutocomplete({
  value,
  onChange,
  onAddressSelect,
  placeholder = "123 Main St",
  id,
  "data-testid": testId,
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedValue = useDebounce(value, 300);

  // Fetch predictions from backend proxy
  useEffect(() => {
    if (!debouncedValue || debouncedValue.length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    fetch(`/api/places/autocomplete?input=${encodeURIComponent(debouncedValue)}`)
      .then(r => r.json())
      .then((data: { predictions: Prediction[] }) => {
        if (cancelled) return;
        const preds = data.predictions || [];
        setPredictions(preds);
        setOpen(preds.length > 0);
        setActiveIndex(-1);
      })
      .catch(() => {
        if (!cancelled) {
          setPredictions([]);
          setOpen(false);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [debouncedValue]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectPrediction = useCallback(async (prediction: Prediction) => {
    // Show the full description in the address field while we fetch details
    onChange(prediction.structured_formatting?.main_text || prediction.description);
    setOpen(false);
    setPredictions([]);

    try {
      const res = await fetch(`/api/places/detail?place_id=${encodeURIComponent(prediction.place_id)}`);
      const data = await res.json();

      if (!data.result?.address_components) {
        // Fallback: parse from the description string
        const parts = prediction.description.split(", ");
        onAddressSelect({
          address: parts[0] || prediction.description,
          city: parts[1] || "",
          state: parts[2]?.split(" ")[0] || "",
          zip: parts[2]?.split(" ")[1] || "",
        });
        return;
      }

      const components = data.result.address_components as Array<{
        long_name: string;
        short_name: string;
        types: string[];
      }>;

      const get = (type: string, useShort = false) => {
        const c = components.find(c => c.types.includes(type));
        return c ? (useShort ? c.short_name : c.long_name) : "";
      };

      const streetNumber = get("street_number");
      const route = get("route");
      const address = [streetNumber, route].filter(Boolean).join(" ");
      const city = get("locality") || get("sublocality") || get("neighborhood");
      const state = get("administrative_area_level_1", true); // short name: "CA"
      const zip = get("postal_code");

      onAddressSelect({ address, city, state, zip });
    } catch {
      // If detail fetch fails, parse from prediction description
      const parts = prediction.description.split(", ");
      onAddressSelect({
        address: parts[0] || prediction.description,
        city: parts[1] || "",
        state: parts[2]?.split(" ")[0] || "",
        zip: parts[2]?.split(" ")[1] || "",
      });
    }
  }, [onChange, onAddressSelect]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, predictions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectPrediction(predictions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="street-address"
        data-testid={testId}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-haspopup="listbox"
      />

      {open && predictions.length > 0 && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden"
        >
          {predictions.map((pred, idx) => (
            <button
              key={pred.place_id}
              role="option"
              aria-selected={idx === activeIndex}
              className={`w-full flex items-start gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
                idx === activeIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground"
              }`}
              onMouseDown={e => {
                // Use mousedown to prevent input blur before click registers
                e.preventDefault();
                selectPrediction(pred);
              }}
            >
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="leading-snug">
                <span className="font-medium">
                  {pred.structured_formatting?.main_text || pred.description}
                </span>
                {pred.structured_formatting?.secondary_text && (
                  <span className="text-muted-foreground block text-xs">
                    {pred.structured_formatting.secondary_text}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
