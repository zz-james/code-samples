/**
* this is a React component written in typescript
* it wraps a tooltip library and exports a hook which can be used to quickly add tooltips
* these tooltips can contain html, links, buttons etc and can track elements that are moving on the page
* a react component which uses this tooltip simple includes this file then calls the hook with some config e.g.
* const { tooltip, setTooltipReferenceElement } = useTooltip({
*    active: showTooltip,
*    message: fullNames.join(', '),
*    placement: 'bottom',
*    allowHover: true,
*  });
*
* this returns 2 things, the tooltip component itself and a function to be used as a ref
* so in the jsx it is as simple as
* <span ref={setTooltipReferenceElement}>...</span> 
* to set the element that triggers the tooltip and for example
* <div> {tooltip} </div>
* to set the element where the tooltip will appear (this can be any block element)
*/



import React, {
  useState,
  useImperativeHandle,
  ReactNode,
  Ref,
  useEffect,
  HTMLProps,
  useRef,
} from 'react';
import cx from 'classnames';
import { usePopper } from 'react-popper';
import { State, Placement } from '@popperjs/core';
import useTheme from '../../hooks/useTheme';
import usePrevious from '../../hooks/usePrevious';
import styles from './Tooltip.module.css';

export type TooltipHandle = {
  update: (() => Promise<Partial<State>>) | null;
  forceUpdate: (() => void) | null;
};

export type Theme = typeof styles;

type Props = HTMLProps<HTMLDivElement> & {
  children?: ReactNode;
  active: boolean;
  referenceElement: HTMLElement | null;
  tooltipHandle: Ref<TooltipHandle>;
  placement?: Placement;
  theme?: Partial<Theme>;
  errorStyle?: boolean;
};

const Tooltip = ({
  children,
  active,
  referenceElement,
  tooltipHandle,
  placement = 'top',
  theme: customTheme = {},
  errorStyle = false,
  ...props
}: Props) => {
  const theme = useTheme(styles, customTheme);

  const [popperElement, setTooltipElement] = useState<HTMLElement | null>(null);

  const [arrowElement, setArrowElement] = useState<HTMLElement | null>(null);

  const {
    styles: tooltipStyles,
    attributes: tooltipAttributes,
    update,
    forceUpdate,
  } = usePopper(referenceElement, popperElement, {
    modifiers: [
      { name: 'eventListeners', enabled: false },
      {
        name: 'arrow',
        options: {
          element: arrowElement,
        },
      },
      {
        name: 'offset',
        options: {
          offset: [0, 4],
        },
      },
      {
        name: 'preventOverflow',
        options: {
          altBoundary: true,
        },
      },
    ],
    placement,
    strategy: 'absolute',
  });

  useEffect(() => {
    if (!update || !active) return;
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update, active]);

  useImperativeHandle(
    tooltipHandle,
    () => ({
      update,
      forceUpdate,
    }),
    [update, forceUpdate]
  );

  return (
    <div
      ref={setTooltipElement}
      className={cx(theme.tooltip, { [styles.errorStyle]: errorStyle })}
      style={tooltipStyles.popper}
      {...tooltipAttributes.popper}
      data-show={active}
      {...props}
    >
      <div className={styles.topHitBox} />
      <div className={styles.bottomHitBox} />
      <div className={styles.leftHitBox} />
      <div className={styles.rightHitBox} />
      {children}
      <div
        ref={setArrowElement}
        className={theme.arrow}
        style={tooltipStyles.arrow}
      />
    </div>
  );
};
export default Tooltip;

export function useTooltip({
  active,
  message,
  errorStyle,
  placement,
  allowHover,
  theme,
}: {
  active: boolean;
  message: React.ReactNode;
  errorStyle?: boolean;
  placement?: Placement;
  allowHover?: boolean;
  theme?: Partial<Theme>;
}) {
  const [
    tooltipReferenceElement,
    setTooltipReferenceElement,
  ] = useState<HTMLElement | null>(null);

  const [hover, setHover] = useState<boolean>(false);

  const tooltipHandle = useRef<TooltipHandle>(null);

  const previousActive = usePrevious(active);
  useEffect(() => {
    // only update when the tooltip is visible.
    if (tooltipHandle.current?.update && !previousActive && active) {
      tooltipHandle.current?.update();
    }
  }, [previousActive, active]);

  const tooltip = (
    <Tooltip
      referenceElement={tooltipReferenceElement}
      active={active || hover}
      tooltipHandle={tooltipHandle}
      errorStyle={errorStyle}
      placement={placement}
      onMouseEnter={
        allowHover
          ? () => {
              setHover(true);
            }
          : undefined
      }
      onMouseLeave={
        allowHover
          ? () => {
              setHover(false);
            }
          : undefined
      }
      theme={theme}
    >
      {message}
    </Tooltip>
  );

  return {
    tooltip,
    setTooltipReferenceElement,
    tooltipHandleRef: tooltipHandle,
  };
}
