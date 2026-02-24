import * as React from "react";
import { cx } from "./cx";

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cx("ui-card", className)} {...rest} />;
}

export function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cx("ui-card__header", className)} {...rest} />;
}

export function CardTitle(props: React.HTMLAttributes<HTMLHeadingElement>) {
  const { className, ...rest } = props;
  return <h3 className={cx("ui-card__title", className)} {...rest} />;
}

export function CardSubtitle(
  props: React.HTMLAttributes<HTMLParagraphElement>,
) {
  const { className, ...rest } = props;
  return <p className={cx("ui-card__subtitle", className)} {...rest} />;
}

export function CardContent(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cx("ui-card__content", className)} {...rest} />;
}
