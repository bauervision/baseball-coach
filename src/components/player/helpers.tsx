
function SvgIcon(props: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      {props.children}
    </svg>
  );
}

export function IconBat() {
  return (
    <SvgIcon>
      <path
        d="M6.5 17.5l11-11"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M16.5 6.5l1.8-1.8c.7-.7 1.8-.7 2.5 0 .7.7.7 1.8 0 2.5L19 9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M5 19l2-2"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

export function IconDiamond() {
  return (
    <SvgIcon>
      <path d="M12 3l8 9-8 9-8-9 8-9z" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </SvgIcon>
  );
}

export function IconBall() {
  return (
    <SvgIcon>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8.3 6.8c1.2 1 2 2.8 2 5.2s-.8 4.2-2 5.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15.7 6.8c-1.2 1-2 2.8-2 5.2s.8 4.2 2 5.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

export function IconScoreboard() {
  return (
    <SvgIcon>
      <rect
        x="5"
        y="6"
        width="14"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 10h3M8 14h3M13 10h3M13 14h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}
