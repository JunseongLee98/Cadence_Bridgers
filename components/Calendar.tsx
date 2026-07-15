'use client';

import React, { useState, useMemo } from 'react';
import { Calendar as BigCalendar, momentLocalizer, View, type EventProps } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { CalendarEvent } from '@/types';
import { isAllDayLikeEvent } from '@/lib/calendar-event-utils';

type DisplayEvent = CalendarEvent & { allDay?: boolean };

interface CalendarProps {
  events: CalendarEvent[];
  date?: Date;
  view?: View;
  workHours?: {
    segments: {
      startHour: number;
      endHour: number;
    }[];
  };
  onDateChange?: (date: Date) => void;
  onViewChange?: (view: View) => void;
  onSelectSlot?: (slot: { start: Date; end: Date }) => void;
  onSelectEvent?: (event: CalendarEvent) => void;
}

const localizer = momentLocalizer(moment);

interface TimeSlotWrapperProps {
  children: React.ReactElement;
  value: Date;
}

// Custom wrapper to visually indicate past time and current time within today
function TimeSlotWrapper({ children, value }: TimeSlotWrapperProps) {
  const now = new Date();

  const isSameDay =
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();

  const isPastToday = isSameDay && value < now;

  // Treat each 30-minute bucket as a slot and highlight the one that contains "now"
  const slotMinutes = value.getMinutes();
  const currentBucketStart = Math.floor(now.getMinutes() / 30) * 30;
  const isCurrentSlot =
    isSameDay &&
    value.getHours() === now.getHours() &&
    slotMinutes === currentBucketStart;

  const baseClassName = (children.props as any).className || '';
  const tintedClassName = isPastToday ? `${baseClassName} bg-gray-100` : baseClassName;

  const slotContent = React.cloneElement(children, {
    className: tintedClassName,
  });

  if (!isCurrentSlot) {
    return slotContent;
  }

  return (
    <div className="relative">
      {slotContent}
      <div className="pointer-events-none absolute inset-x-0 top-0 border-t-2 border-red-500" />
    </div>
  );
}

function TimedEventTitle({ event, title }: EventProps<DisplayEvent>) {
  const durationMins = Math.max(
    0,
    Math.round((event.end.getTime() - event.start.getTime()) / (1000 * 60))
  );
  const isShort = !event.allDay && durationMins > 0 && durationMins <= 30;
  return (
    <div
      className={
        isShort ? 'calendar-event-title calendar-event-title--short' : 'calendar-event-title'
      }
      title={title}
    >
      {title}
    </div>
  );
}

export default function Calendar({ events, date, view, workHours, onDateChange, onViewChange, onSelectSlot, onSelectEvent }: CalendarProps) {
  const [currentView, setCurrentView] = useState<View>('week');
  const [internalDate, setInternalDate] = useState(new Date());

  const currentDate = date ?? internalDate;

  // Handles navigation (Back / Next / Today)
  const handleNavigate = (nextDate: Date) => {
    if (onDateChange) {
      onDateChange(nextDate);
    } else {
      setInternalDate(nextDate);
    }
  };

  const formattedEvents = useMemo(() => {
    return events.map((event) => {
      const allDay = isAllDayLikeEvent(event);
      return {
        ...event,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay,
      };
    });
  }, [events]);

  // Earliest timed (non–all-day) start by clock time — all-day midnight must not yank scroll up.
  const scrollTargetTime = useMemo(() => {
    const fallbackHour = workHours?.segments?.[0]?.startHour ?? 9;
    const fallback = new Date(1970, 0, 1, fallbackHour, 0, 0);

    const timed = (events ?? []).filter((ev) => !isAllDayLikeEvent(ev));
    if (timed.length === 0) {
      return fallback;
    }

    let bestMins = Number.POSITIVE_INFINITY;
    for (const ev of timed) {
      const mins = ev.start.getHours() * 60 + ev.start.getMinutes();
      if (mins < bestMins) {
        bestMins = mins;
      }
    }

    if (!Number.isFinite(bestMins)) {
      return fallback;
    }

    return new Date(1970, 0, 1, Math.floor(bestMins / 60), bestMins % 60, 0, 0);
  }, [events, workHours?.segments]);

  const eventStyleGetter = (event: DisplayEvent) => {
    const isTaskBlock = Boolean(event.taskId);
    const durationMins = Math.round(
      (event.end.getTime() - event.start.getTime()) / (1000 * 60)
    );
    const isShortTimed = !event.allDay && durationMins > 0 && durationMins <= 30;
    return {
      className: [
        isTaskBlock ? 'rbc-event--cadence-task' : '',
        isShortTimed ? 'rbc-event--short' : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
      style: {
        backgroundColor: event.color || '#dbeafe',
        borderRadius: '4px',
        opacity: 1,
        color: '#111827', // near-black for strong contrast
        border: '1px solid rgba(24, 24, 26, 0.16)',
        fontWeight: 500,
        display: 'block',
        // Sit above subscribed / Google layers when overlap layout stacks events.
        zIndex: isTaskBlock ? 5 : 1,
      },
    };
  };
  
  const WeekHeader = ({ date }: { date: Date }) => {
    const day = date
      .toLocaleDateString("en-US", { weekday: "short" })
      .toUpperCase();

    const number = date.toLocaleDateString("en-US", { day: "2-digit" });
    const today = new Date();
    const isToday =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();

    return (
      <div className={`calendar-week-header ${isToday ? "calendar-week-header-today" : ""}`}>
        <div className="calendar-week-day">{day}</div>
        <div className="calendar-week-number">{number}</div>
      </div>
    );
  };

  const slotPropGetter = (date: Date) => {
    const segments = workHours?.segments ?? [{ startHour: 9, endHour: 18 }];

    if (segments.length === 0) {
      return {};
    }

    const hour = date.getHours() + date.getMinutes() / 60;
    const insideWorkHours = segments.some((segment) => {
      return hour >= segment.startHour && hour < segment.endHour;
    });

    if (insideWorkHours) {
      return {};
    }

    return {
      className: 'calendar-outside-work-hours',
    };
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0">
        <BigCalendar
          localizer={localizer}
          events={formattedEvents}
          startAccessor="start"
          endAccessor="end"
          allDayAccessor="allDay"
          style={{ height: '100%' }}
          view={view ?? currentView}
          onView={onViewChange ?? setCurrentView}
          date={currentDate}
          messages={{
            previous: "‹",
            today: "Today",
            next: "›",
          }}
          onNavigate={handleNavigate}
          onSelectSlot={onSelectSlot}
          onSelectEvent={onSelectEvent}
          selectable
          eventPropGetter={eventStyleGetter}
          slotPropGetter={slotPropGetter}
          defaultDate={new Date()}
          // Allow viewing the full day while auto-scrolling near the user's typical start time.
          min={new Date(1970, 0, 1, 0, 0, 0)}
          max={new Date(1970, 0, 1, 23, 59, 0)}
          scrollToTime={scrollTargetTime}
          formats={{
            timeGutterFormat: (date: Date) =>
              date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                hour12: true,
              }),
          }}
          components={{
            toolbar: () => null,
            header: WeekHeader,
            event: TimedEventTitle,
            timeSlotWrapper: TimeSlotWrapper as unknown as React.ComponentType,
          }}
        />
      </div>
    </div>
  );
}
