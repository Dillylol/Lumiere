package dev.lumiere.ftc;

import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.paths.curves.Curve;
import com.pedropathing.paths.interpolator.Interpolator;
import com.pedropathing.utils.Angle;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Heading interpolators for Pedro Pathing paths.
 *
 * <p>In Pedro Pathing 3.0.0, {@code Path.linear(...)} turns the wrong way on straight lines and
 * compound paths: the default {@code Curve.pathCompletion} reports the distance remaining instead of
 * the distance travelled, so the robot starts at the end heading and finishes at the start heading.
 * Bezier curves are not affected. These interpolators measure progress from
 * {@code Curve.remainingDistance}, which is correct for every curve type, so they give the intended
 * result now and after an upstream fix.
 *
 * <pre>{@code
 * Path toScore = line(start, score).heading(Headings.linear(start, score));
 * }</pre>
 */
public final class Headings {
    private Headings() {
    }

    /** Turns from the start pose's heading to the end pose's heading along the whole path, the short way. */
    public static Interpolator linear(Pose start, Pose end) {
        return linear(start.heading(), end.heading());
    }

    /** Turns from {@code startRadians} to {@code endRadians} along the whole path, the short way. */
    public static Interpolator linear(double startRadians, double endRadians) {
        return linearUntil(startRadians, endRadians, 1.0);
    }

    /**
     * Turns from the start heading to the end heading over the first part of the path, then holds the
     * end heading.
     *
     * @param endCompletion fraction of the path's length, in (0, 1], at which the turn finishes
     */
    public static Interpolator linearUntil(Pose start, Pose end, double endCompletion) {
        return linearUntil(start.heading(), end.heading(), endCompletion);
    }

    /** See {@link #linearUntil(Pose, Pose, double)}. */
    public static Interpolator linearUntil(double startRadians, double endRadians, double endCompletion) {
        if (!(endCompletion > 0 && endCompletion <= 1)) {
            throw new IllegalArgumentException("endCompletion must be greater than 0 and at most 1, but was " + endCompletion);
        }
        final double start = Angle.normalize(startRadians);
        final double delta = Angle.error(start, Angle.normalize(endRadians));
        return (curve, t) -> Angle.normalize(start + delta * Math.min(1.0, completion(curve, t) / endCompletion));
    }

    /**
     * Starts a heading made of rules for different parts of the path. Progress is the fraction of
     * the path's length travelled. Where no rule covers the progress, the nearest rule's boundary
     * value is used.
     *
     * <pre>{@code
     * Path path = curve(a, control, b).heading(Headings.piecewise()
     *         .tangent(0, 0.6, false)
     *         .linear(0.6, 1, Math.toRadians(90), Math.toRadians(180))
     *         .build());
     * }</pre>
     */
    public static Piecewise piecewise() {
        return new Piecewise();
    }

    /** Builder returned by {@link #piecewise()}. */
    public static final class Piecewise {
        private interface Rule {
            double heading(Curve curve, double t, double local);
        }

        private static final class Segment {
            final double start;
            final double end;
            final Rule rule;

            Segment(double start, double end, Rule rule) {
                this.start = start;
                this.end = end;
                this.rule = rule;
            }
        }

        private final List<Segment> segments = new ArrayList<>();

        private Piecewise() {
        }

        /** Turns evenly from {@code startRadians} to {@code endRadians}, the short way, across the range. */
        public Piecewise linear(double startProgress, double endProgress, double startRadians, double endRadians) {
            final double start = Angle.normalize(startRadians);
            final double delta = Angle.error(start, Angle.normalize(endRadians));
            return add(startProgress, endProgress, (curve, t, local) -> Angle.normalize(start + delta * local));
        }

        /** Faces {@code radians} across the range. */
        public Piecewise constant(double startProgress, double endProgress, double radians) {
            final double heading = Angle.normalize(radians);
            return add(startProgress, endProgress, (curve, t, local) -> heading);
        }

        /** Faces along the path, or backwards along it when {@code reverse} is true. */
        public Piecewise tangent(double startProgress, double endProgress, boolean reverse) {
            return add(startProgress, endProgress,
                    (curve, t, local) -> Angle.normalize(curve.derivative(t).theta() + (reverse ? Math.PI : 0)));
        }

        /** Faces the field point ({@code x}, {@code y}). */
        public Piecewise facingPoint(double startProgress, double endProgress, double x, double y) {
            return add(startProgress, endProgress, (curve, t, local) -> {
                Vector2D position = curve.get(t);
                return Angle.normalize(Math.atan2(y - position.y(), x - position.x()));
            });
        }

        private Piecewise add(double start, double end, Rule rule) {
            if (!(start >= 0 && end <= 1 && start <= end)) {
                throw new IllegalArgumentException("Progress must satisfy 0 <= start <= end <= 1, but was " + start + " to " + end);
            }
            segments.add(new Segment(start, end, rule));
            return this;
        }

        public Interpolator build() {
            if (segments.isEmpty()) throw new IllegalStateException("Add at least one heading rule.");
            final List<Segment> sorted = new ArrayList<>(segments);
            Collections.sort(sorted, (a, b) -> Double.compare(a.start, b.start));
            return (curve, t) -> {
                double progress = completion(curve, t);
                Segment chosen = sorted.get(sorted.size() - 1);
                for (Segment segment : sorted) {
                    if (progress <= segment.end) {
                        chosen = segment;
                        break;
                    }
                }
                double width = chosen.end - chosen.start;
                double local = width > 0 ? Math.max(0, Math.min(1, (progress - chosen.start) / width)) : 1;
                return chosen.rule.heading(curve, t, local);
            };
        }
    }

    /** Fraction of the curve's length travelled at parameter {@code t}, from 0 at the start to 1 at the end. */
    public static double completion(Curve curve, double t) {
        double length = curve.length();
        if (!(length > 0)) return 0;
        double travelled = 1.0 - curve.remainingDistance(t) / length;
        return Math.max(0.0, Math.min(1.0, travelled));
    }
}
