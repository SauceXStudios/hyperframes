import { memo } from "react";
import { Tooltip } from "../../components/ui";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Icon } from "../../icons/Icon";

interface VolumeControlProps {
  audioMuted: boolean;
  audioVolume: number;
  disabled: boolean;
  setAudioMuted: (muted: boolean) => void;
  setAudioVolume: (volume: number) => void;
}

function VolumeIcon({ muted, volume }: { muted: boolean; volume: number }) {
  if (muted || volume === 0) return <Icon name="speakerX" size={14} />;
  return <Icon name={volume >= 0.5 ? "speakerHigh" : "speakerLow"} size={14} />;
}

export const VolumeControl = memo(function VolumeControl({
  audioMuted,
  audioVolume,
  disabled,
  setAudioMuted,
  setAudioVolume,
}: VolumeControlProps) {
  const percentage = Math.round(audioVolume * 100);
  const silent = audioMuted || audioVolume === 0;
  const muteLabel = silent ? "Unmute audio" : "Mute audio";

  return (
    <div className="group flex flex-shrink-0 items-center">
      <div className="w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-150 ease-out group-hover:w-14 group-hover:opacity-100 group-focus-within:w-14 group-focus-within:opacity-100">
        <div className="relative mx-1 flex h-6 w-12 items-center">
          <div className="absolute inset-x-0 h-0.5 overflow-hidden rounded-full bg-neutral-700">
            <div
              className="h-full rounded-full bg-neutral-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={percentage}
            disabled={disabled}
            aria-label="Preview volume"
            aria-valuetext={`${percentage}%`}
            title={`Preview volume: ${percentage}%`}
            onChange={(event) => {
              const volume = Number(event.currentTarget.value) / 100;
              setAudioVolume(volume);
              if (audioMuted && volume > 0) setAudioMuted(false);
            }}
            className="hf-preview-volume-range absolute inset-0 w-full disabled:pointer-events-none"
          />
        </div>
      </div>

      <Tooltip label={muteLabel}>
        <button
          type="button"
          onClick={() => {
            trackStudioEvent("playback", { action: "mute_toggle", muted: !silent });
            if (silent && audioVolume === 0) setAudioVolume(1);
            setAudioMuted(!silent);
          }}
          disabled={disabled}
          aria-label={muteLabel}
          aria-pressed={silent}
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30 ${
            silent ? "text-studio-accent" : "text-neutral-500 hover:text-neutral-200"
          }`}
        >
          <VolumeIcon muted={audioMuted} volume={audioVolume} />
        </button>
      </Tooltip>
    </div>
  );
});
