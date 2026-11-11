package dev.lumiere.ftc.live;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * An autonomous program as Lumière sends it to Lumière Live, read and checked for shape before the
 * robot looks at its hardware.
 *
 * <p>Angles are in degrees, as the project stores them and as generated OpModes pass them to Pedro
 * Pathing, and every path carries the same start, control and end poses the generated Java uses. So
 * Lumière Live can build exactly the paths a deployed OpMode would. docs/protocol.md describes the
 * format.
 *
 * <p>Format 2 lists every device the program drives once, with its direction, power limit and travel;
 * mechanisms name their devices from that list, and the routine can set a device directly and hold an
 * action for a time. Format 1 kept each device's settings in its mechanism and had no power limits of
 * its own: every device of a format 1 program gets the limit {@link #read(Object, double)} is given.
 */
public final class LiveProgram {
    /** The newest program format this library reads. It also reads every format back to 1. */
    public static final int FORMAT = 2;
    static final int MAX_STEPS = 1000;
    static final int MAX_DEPTH = 8;
    static final double MAX_WAIT_MS = 600_000;
    static final int MAX_DEVICES = 100;
    /** Poses must stay near Pedro Pathing's 144-inch field. */
    static final double FIELD_MIN = -24;
    static final double FIELD_MAX = 168;

    public static final class Pose {
        public final double x;
        public final double y;
        public final double headingDeg;

        Pose(double x, double y, double headingDeg) {
            this.x = x;
            this.y = y;
            this.headingDeg = headingDeg;
        }
    }

    public static final class Point {
        public final double x;
        public final double y;

        Point(double x, double y) {
            this.x = x;
            this.y = y;
        }
    }

    /** A heading rule, as in the project: {@code linear}, {@code constant}, {@code tangential} or {@code piecewise}. */
    public static final class Heading {
        public final String type;
        public final double startDeg;
        public final double endDeg;
        public final double degrees;
        public final boolean reverse;
        /** For {@code piecewise}: the rules over parts of the path, in order. */
        public final List<HeadingPart> parts;

        Heading(String type, double startDeg, double endDeg, double degrees, boolean reverse, List<HeadingPart> parts) {
            this.type = type;
            this.startDeg = startDeg;
            this.endDeg = endDeg;
            this.degrees = degrees;
            this.reverse = reverse;
            this.parts = parts;
        }
    }

    /** One rule of a piecewise heading, between two fractions of the path's length. */
    public static final class HeadingPart {
        public final double startProgress;
        public final double endProgress;
        /** {@code linear}, {@code constant}, {@code tangential} or {@code facingPoint}. */
        public final String type;
        public final double startDeg;
        public final double endDeg;
        public final double degrees;
        public final boolean reverse;
        public final Point point;

        HeadingPart(double startProgress, double endProgress, String type, double startDeg, double endDeg, double degrees, boolean reverse, Point point) {
            this.startProgress = startProgress;
            this.endProgress = endProgress;
            this.type = type;
            this.startDeg = startDeg;
            this.endDeg = endDeg;
            this.degrees = degrees;
            this.reverse = reverse;
            this.point = point;
        }
    }

    /** A line (no control points) or Bezier curve from {@code start} to {@code end}. */
    public static final class Segment {
        public final Pose start;
        public final List<Point> controls;
        public final Pose end;
        /** The segment's own heading rule, or null when its compound path sets one for all segments. */
        public final Heading heading;

        Segment(Pose start, List<Point> controls, Pose end, Heading heading) {
            this.start = start;
            this.controls = controls;
            this.end = end;
            this.heading = heading;
        }
    }

    public static final class Path {
        public final String id;
        public final String name;
        /** A compound path is followed as one chain of segments; an atomic path has exactly one segment. */
        public final boolean compound;
        public final List<Segment> segments;
        /** For a compound path, the heading rule across all segments, or null when each segment has its own. */
        public final Heading heading;

        Path(String id, String name, boolean compound, List<Segment> segments, Heading heading) {
            this.id = id;
            this.name = name;
            this.compound = compound;
            this.segments = segments;
            this.heading = heading;
        }
    }

    /**
     * A device with its settings. In a mechanism, {@code id} is the mechanism's own id for it; in the
     * program's device list, it is the device's name.
     */
    public static final class Device {
        public final String id;
        /** The name in the Robot Controller configuration. */
        public final String name;
        /** {@code motor}, {@code servo} or {@code crservo}. */
        public final String kind;
        public final boolean reversed;
        /** The most power a motor or continuous servo is given, above 0 and at most 1. Larger powers are cut to it. */
        public final double powerLimit;
        /** For a motor that takes encoder targets: the ticks it may travel between, or null when not set. */
        public final Travel travel;

        Device(String id, String name, String kind, boolean reversed, double powerLimit, Travel travel) {
            this.id = id;
            this.name = name;
            this.kind = kind;
            this.reversed = reversed;
            this.powerLimit = powerLimit;
            this.travel = travel;
        }

        /** A power cut to this device's limit, keeping its direction. */
        public double limited(double power) {
            return Math.max(-powerLimit, Math.min(powerLimit, power));
        }
    }

    /** A motor's soft limits, in encoder ticks from where it was at INIT. */
    public static final class Travel {
        public final int minTicks;
        public final int maxTicks;

        Travel(int minTicks, int maxTicks) {
            this.minTicks = minTicks;
            this.maxTicks = maxTicks;
        }
    }

    /** A device's output in a state: {@code power} (-1 to 1), {@code position} (0 to 1), or an encoder {@code target}. */
    public static final class Output {
        public final String kind;
        public final double value;
        public final int ticks;
        public final double power;

        Output(String kind, double value, int ticks, double power) {
            this.kind = kind;
            this.value = value;
            this.ticks = ticks;
            this.power = power;
        }
    }

    public static final class State {
        public final String id;
        public final String name;
        /** Outputs by device id. Devices without an entry are left as they are. */
        public final Map<String, Output> outputs;

        State(String id, String name, Map<String, Output> outputs) {
            this.id = id;
            this.name = name;
            this.outputs = outputs;
        }
    }

    public static final class Mechanism {
        public final String id;
        public final String name;
        public final List<Device> devices;
        public final List<State> states;
        /** The state applied at INIT, or null to leave the hardware as it is. */
        public final String initialState;

        Mechanism(String id, String name, List<Device> devices, List<State> states, String initialState) {
            this.id = id;
            this.name = name;
            this.devices = devices;
            this.states = states;
            this.initialState = initialState;
        }
    }

    /**
     * A routine step: {@code path}, {@code wait}, {@code state}, {@code device} (format 2), or a
     * {@code together} or {@code race} group. A timed state or device step holds for
     * {@link #durationMs}, then sets {@link #thenState}, stops its device, or moves its servo to
     * {@link #thenPosition}.
     */
    public static final class Step {
        public final String kind;
        public final String path;
        public final double ms;
        public final String mechanism;
        public final String state;
        public final List<Step> steps;
        /** For a device step: the device's configured name, and what it is set to. */
        public final String device;
        public final Output output;
        /** For a timed state or device step: how long it holds, in milliseconds. 0 when it is not timed. */
        public final double durationMs;
        /** For a timed state step: the state it sets when the time is up. */
        public final String thenState;
        /** For a timed servo step: the position after. NaN otherwise. */
        public final double thenPosition;

        Step(String kind, String path, double ms, String mechanism, String state, List<Step> steps) {
            this(kind, path, ms, mechanism, state, steps, null, null, 0, null, Double.NaN);
        }

        Step(String kind, String path, double ms, String mechanism, String state, List<Step> steps,
             String device, Output output, double durationMs, String thenState, double thenPosition) {
            this.kind = kind;
            this.path = path;
            this.ms = ms;
            this.mechanism = mechanism;
            this.state = state;
            this.steps = steps;
            this.device = device;
            this.output = output;
            this.durationMs = durationMs;
            this.thenState = thenState;
            this.thenPosition = thenPosition;
        }

        public boolean timed() {
            return durationMs > 0;
        }
    }

    /** A program read from its JSON, or the problems that stopped it from being read. */
    public static final class Reading {
        /** The program, or null when it has problems. */
        public final LiveProgram program;
        public final List<String> problems;

        Reading(LiveProgram program, List<String> problems) {
            this.program = program;
            this.problems = Collections.unmodifiableList(problems);
        }
    }

    /** The format the program was sent in. */
    public final int format;
    public final String name;
    public final String revision;
    public final Pose start;
    /** Every device the program drives, once each, with its settings: its mechanisms' devices and the ones it sets directly. */
    public final List<Device> devices;
    public final List<Mechanism> mechanisms;
    public final List<Path> paths;
    public final List<Step> routine;

    private LiveProgram(int format, String name, String revision, Pose start, List<Device> devices, List<Mechanism> mechanisms, List<Path> paths, List<Step> routine) {
        this.format = format;
        this.name = name;
        this.revision = revision;
        this.start = start;
        this.devices = devices;
        this.mechanisms = mechanisms;
        this.paths = paths;
        this.routine = routine;
    }

    public Mechanism mechanism(String id) {
        for (Mechanism mechanism : mechanisms) if (mechanism.id.equals(id)) return mechanism;
        return null;
    }

    /** The program's device with this configured name, or null. */
    public Device device(String name) {
        for (Device device : devices) if (device.name.equals(name)) return device;
        return null;
    }

    /** Reads a program from the {@code program} field of a {@code program} message, a format 1 program without a power limit. */
    public static Reading read(Object json) {
        return read(json, 1);
    }

    /**
     * Reads a program from the {@code program} field of a {@code program} message.
     *
     * @param formatOneLimit the power limit every device of a format 1 program gets; format 2 programs carry their own
     */
    public static Reading read(Object json, double formatOneLimit) {
        Reader reader = new Reader(formatOneLimit);
        LiveProgram program = reader.program(json);
        return new Reading(reader.problems.isEmpty() ? program : null, reader.problems);
    }

    /** Collects every problem instead of stopping at the first, so the team can fix them in one go. */
    private static final class Reader {
        final List<String> problems = new ArrayList<>();
        private final double formatOneLimit;
        private int format;
        /** Format 2: the program's devices by name. Format 1: filled from the mechanisms as they are read. */
        private final Map<String, Device> devices = new LinkedHashMap<>();
        private int steps;

        Reader(double formatOneLimit) {
            this.formatOneLimit = formatOneLimit > 0 && formatOneLimit <= 1 ? formatOneLimit : 1;
        }

        void problem(String message) {
            if (problems.size() < 50) problems.add(message);
        }

        LiveProgram program(Object json) {
            Map<String, Object> root = object(json);
            if (root == null) {
                problem("The program is missing.");
                return null;
            }
            Object format = root.get("format");
            double number = format instanceof Number ? ((Number) format).doubleValue() : Double.NaN;
            if (number != 1 && number != 2) {
                if (number > FORMAT) {
                    problem("This program needs a newer robot library. Update Lumière's robot library and install the robot code again.");
                } else {
                    problem("The program's format is not one this robot library reads.");
                }
                return null;
            }
            this.format = (int) number;
            String name = text(root, "name", 120);
            if (name == null || name.trim().isEmpty()) problem("The program has no name.");
            String revision = text(root, "revision", 64);
            if (revision == null) problem("The program has no revision.");
            Pose start = pose(root.get("start"), "The start pose");

            if (this.format >= 2) {
                for (Object item : list(root.get("devices"), "devices", MAX_DEVICES)) {
                    Device device = device(item);
                    if (device != null && devices.put(device.name, device) != null) problem("The program lists \"" + device.name + "\" twice.");
                }
            }

            List<Mechanism> mechanisms = new ArrayList<>();
            Set<String> mechanismIds = new HashSet<>();
            for (Object item : list(root.get("mechanisms"), "mechanisms", 30)) {
                Mechanism mechanism = mechanism(item);
                if (mechanism == null) continue;
                if (!mechanismIds.add(mechanism.id)) problem("Two mechanisms share the id \"" + mechanism.id + "\".");
                mechanisms.add(mechanism);
            }

            List<Path> paths = new ArrayList<>();
            Set<String> pathIds = new HashSet<>();
            for (Object item : list(root.get("paths"), "paths", 200)) {
                Path path = path(item);
                if (path == null) continue;
                if (!pathIds.add(path.id)) problem("Two paths share the id \"" + path.id + "\".");
                paths.add(path);
            }

            List<Step> routine = steps(root.get("routine"), 1, pathIds, mechanisms);
            if (name == null || revision == null || start == null) return null;
            return new LiveProgram(this.format, name.trim(), revision, start, Collections.unmodifiableList(new ArrayList<>(devices.values())),
                    Collections.unmodifiableList(mechanisms), Collections.unmodifiableList(paths), Collections.unmodifiableList(routine));
        }

        /** A device in a format 2 program's device list, with its settings. */
        Device device(Object json) {
            Map<String, Object> map = object(json);
            String name = map == null ? null : text(map, "name", 80);
            String kind = map == null ? null : text(map, "kind", 20);
            if (name == null || name.trim().isEmpty()) {
                problem("The program lists a device without a name.");
                return null;
            }
            String label = "\"" + name.trim() + "\"";
            if (!"motor".equals(kind) && !"servo".equals(kind) && !"crservo".equals(kind)) {
                problem(label + " is a " + kind + "; Lumière Live drives motors, servos and continuous servos.");
                return null;
            }
            double limit = 1;
            Object given = map.get("powerLimit");
            if (given != null) {
                limit = number(given);
                if ("servo".equals(kind)) problem(label + " is a servo, which takes positions, so it can't have a power limit.");
                else if (!(limit > 0 && limit <= 1)) problem(label + " has a power limit that is not above 0 and at most 1.");
            }
            Travel travel = travel(map.get("travel"), label, kind);
            return new Device(name.trim(), name.trim(), kind, Boolean.TRUE.equals(map.get("reversed")), limit > 0 && limit <= 1 ? limit : 1, travel);
        }

        Mechanism mechanism(Object json) {
            Map<String, Object> map = object(json);
            String id = map == null ? null : text(map, "id", 80);
            String name = map == null ? null : text(map, "name", 120);
            if (id == null || name == null) {
                problem("A mechanism is missing its id or name.");
                return null;
            }
            String label = "\"" + name + "\"";
            List<Device> devices = new ArrayList<>();
            Map<String, Device> byId = new LinkedHashMap<>();
            for (Object item : list(map.get("devices"), label + "'s devices", 12)) {
                Map<String, Object> device = object(item);
                String deviceId = device == null ? null : text(device, "id", 80);
                String deviceName = device == null ? null : text(device, "name", 80);
                String kind = device == null ? null : text(device, "kind", 20);
                if (deviceId == null || deviceName == null || deviceName.trim().isEmpty()) {
                    problem(label + " has a device without an id or name.");
                    continue;
                }
                if (!"motor".equals(kind) && !"servo".equals(kind) && !"crservo".equals(kind)) {
                    problem("\"" + deviceName.trim() + "\" in " + label + " is a " + kind + "; Lumière Live drives motors, servos and continuous servos.");
                    continue;
                }
                Device parsed;
                if (format >= 2) {
                    // The settings are in the program's device list, once for every use.
                    Device listed = this.devices.get(deviceName.trim());
                    if (listed == null) {
                        problem("\"" + deviceName.trim() + "\" in " + label + " is not in the program's device list.");
                        continue;
                    }
                    if (!listed.kind.equals(kind)) {
                        problem("\"" + deviceName.trim() + "\" in " + label + " is used as a " + kind + ", but the program's device list has it as a " + listed.kind + ".");
                        continue;
                    }
                    parsed = new Device(deviceId, listed.name, kind, listed.reversed, listed.powerLimit, listed.travel);
                } else {
                    Object reversed = device.get("reversed");
                    Travel travel = travel(device.get("travel"), "\"" + deviceName.trim() + "\" in " + label, kind);
                    parsed = new Device(deviceId, deviceName.trim(), kind, Boolean.TRUE.equals(reversed), formatOneLimit, travel);
                    if (!this.devices.containsKey(parsed.name)) {
                        this.devices.put(parsed.name, new Device(parsed.name, parsed.name, kind, parsed.reversed, formatOneLimit, travel));
                    }
                }
                if (byId.put(deviceId, parsed) != null) problem(label + " lists the device id \"" + deviceId + "\" twice.");
                devices.add(parsed);
            }
            List<State> states = new ArrayList<>();
            Set<String> stateIds = new HashSet<>();
            for (Object item : list(map.get("states"), label + "'s states", 30)) {
                Map<String, Object> state = object(item);
                String stateId = state == null ? null : text(state, "id", 80);
                String stateName = state == null ? null : text(state, "name", 120);
                if (stateId == null || stateName == null) {
                    problem(label + " has a state without an id or name.");
                    continue;
                }
                if (!stateIds.add(stateId)) problem(label + " lists the state id \"" + stateId + "\" twice.");
                Map<String, Output> outputs = new LinkedHashMap<>();
                Map<String, Object> outputMap = object(state.get("outputs"));
                if (outputMap == null) {
                    problem(label + "'s \"" + stateName + "\" state has no outputs.");
                } else {
                    for (Map.Entry<String, Object> entry : outputMap.entrySet()) {
                        Device device = byId.get(entry.getKey());
                        String where = label + "'s \"" + stateName + "\" state";
                        if (device == null) {
                            problem(where + " sets a device the mechanism does not have.");
                            continue;
                        }
                        Output output = output(entry.getValue(), device, where);
                        if (output != null) outputs.put(device.id, output);
                    }
                }
                states.add(new State(stateId, stateName, Collections.unmodifiableMap(outputs)));
            }
            Object initial = map.get("initialState");
            String initialState = initial instanceof String ? (String) initial : null;
            if (initial != null && (initialState == null || !stateIds.contains(initialState))) problem(label + "'s starting state is not one of its states.");
            return new Mechanism(id, name, Collections.unmodifiableList(devices), Collections.unmodifiableList(states), initialState);
        }

        Output output(Object json, Device device, String where) {
            Map<String, Object> map = object(json);
            String kind = map == null ? null : text(map, "kind", 20);
            String subject = where + " gives \"" + device.name + "\"";
            if ("power".equals(kind)) {
                double value = number(map.get("value"));
                if (device.kind.equals("servo")) problem(subject + " a power, but a servo takes a position.");
                else if (!(value >= -1 && value <= 1)) problem(subject + " a power outside -1 to 1.");
                else return new Output(kind, value, 0, 0);
            } else if ("position".equals(kind)) {
                double value = number(map.get("value"));
                if (!device.kind.equals("servo")) problem(subject + " a position, but only servos take one.");
                else if (!(value >= 0 && value <= 1)) problem(subject + " a position outside 0 to 1.");
                else return new Output(kind, value, 0, 0);
            } else if ("target".equals(kind)) {
                double ticks = number(map.get("ticks"));
                double power = number(map.get("power"));
                if (!device.kind.equals("motor")) problem(subject + " an encoder target, but only motors take one.");
                else if (!(Math.abs(ticks) <= 1_000_000_000) || ticks != Math.rint(ticks)) problem(subject + " an encoder target that is not a whole number of ticks.");
                else if (!(power > 0 && power <= 1)) problem(subject + " an encoder target with a power outside 0 to 1.");
                else return new Output(kind, 0, (int) ticks, power);
            } else {
                problem(subject + " an output Lumière Live does not know.");
            }
            return null;
        }

        Travel travel(Object json, String where, String kind) {
            if (json == null) return null;
            Map<String, Object> map = object(json);
            double min = map == null ? Double.NaN : number(map.get("minTicks"));
            double max = map == null ? Double.NaN : number(map.get("maxTicks"));
            if (!"motor".equals(kind)) {
                problem(where + " has a travel range, but only motors have one.");
                return null;
            }
            if (!(Math.abs(min) <= 1_000_000_000 && Math.abs(max) <= 1_000_000_000) || min != Math.rint(min) || max != Math.rint(max) || min >= max) {
                problem(where + " has a travel range that is not two whole numbers of ticks, lowest first.");
                return null;
            }
            return new Travel((int) min, (int) max);
        }

        Path path(Object json) {
            Map<String, Object> map = object(json);
            String id = map == null ? null : text(map, "id", 80);
            String name = map == null ? null : text(map, "name", 120);
            if (id == null || name == null) {
                problem("A path is missing its id or name.");
                return null;
            }
            String label = "Path \"" + name + "\"";
            String kind = text(map, "kind", 20);
            boolean compound = "compound".equals(kind);
            if (!compound && !"atomic".equals(kind)) {
                problem(label + " is neither atomic nor compound.");
                return null;
            }
            Heading heading = map.get("heading") == null ? null : heading(map.get("heading"), label);
            List<Segment> segments = new ArrayList<>();
            for (Object item : list(map.get("segments"), label + "'s segments", 50)) {
                Map<String, Object> segment = object(item);
                if (segment == null) {
                    problem(label + " has a segment that is not an object.");
                    continue;
                }
                Pose start = pose(segment.get("start"), label + "'s start");
                Pose end = pose(segment.get("end"), label + "'s end");
                List<Point> controls = new ArrayList<>();
                for (Object control : list(segment.get("controls"), label + "'s control points", 20)) {
                    Point point = point(control, label + "'s control point");
                    if (point != null) controls.add(point);
                }
                Heading own = segment.get("heading") == null ? null : heading(segment.get("heading"), label);
                if (start != null && end != null) segments.add(new Segment(start, Collections.unmodifiableList(controls), end, own));
            }
            if (segments.isEmpty()) problem(label + " has no segments.");
            if (!compound && segments.size() > 1) problem(label + " is atomic but has " + segments.size() + " segments.");
            if (!compound && !segments.isEmpty() && segments.get(0).heading == null) problem(label + " has no heading rule.");
            if (compound && heading == null) {
                for (Segment segment : segments) {
                    if (segment.heading == null) {
                        problem(label + " has a segment without a heading rule.");
                        break;
                    }
                }
            }
            return new Path(id, name, compound, Collections.unmodifiableList(segments), heading);
        }

        Heading heading(Object json, String label) {
            Map<String, Object> map = object(json);
            String type = map == null ? null : text(map, "type", 20);
            if (type == null) {
                problem(label + " has a heading rule without a type.");
                return null;
            }
            switch (type) {
                case "linear":
                    return new Heading(type, angle(map.get("startDeg"), label), angle(map.get("endDeg"), label), 0, false, null);
                case "constant":
                    return new Heading(type, 0, 0, angle(map.get("degrees"), label), false, null);
                case "tangential":
                    return new Heading(type, 0, 0, 0, Boolean.TRUE.equals(map.get("reverse")), null);
                case "piecewise": {
                    List<HeadingPart> parts = new ArrayList<>();
                    for (Object item : list(map.get("segments"), label + "'s heading rules", 20)) {
                        Map<String, Object> part = object(item);
                        String partType = part == null ? null : text(part, "type", 20);
                        double from = part == null ? Double.NaN : number(part.get("startProgress"));
                        double to = part == null ? Double.NaN : number(part.get("endProgress"));
                        if (!(from >= 0 && to <= 1 && from < to)) {
                            problem(label + " has a heading rule outside its path, or one that ends before it starts.");
                            continue;
                        }
                        if ("linear".equals(partType)) {
                            parts.add(new HeadingPart(from, to, partType, angle(part.get("startDeg"), label), angle(part.get("endDeg"), label), 0, false, null));
                        } else if ("constant".equals(partType)) {
                            parts.add(new HeadingPart(from, to, partType, 0, 0, angle(part.get("degrees"), label), false, null));
                        } else if ("tangential".equals(partType)) {
                            parts.add(new HeadingPart(from, to, partType, 0, 0, 0, Boolean.TRUE.equals(part.get("reverse")), null));
                        } else if ("facingPoint".equals(partType)) {
                            Point point = point(part.get("point"), label + "'s facing point");
                            if (point != null) parts.add(new HeadingPart(from, to, partType, 0, 0, 0, false, point));
                        } else {
                            problem(label + " has a heading rule Lumière Live does not know.");
                        }
                    }
                    if (parts.isEmpty()) problem(label + " has a piecewise heading with no rules.");
                    return new Heading(type, 0, 0, 0, false, Collections.unmodifiableList(parts));
                }
                default:
                    problem(label + " has a heading rule Lumière Live does not know.");
                    return null;
            }
        }

        List<Step> steps(Object json, int depth, Set<String> pathIds, List<Mechanism> mechanisms) {
            List<Step> steps = new ArrayList<>();
            if (depth > MAX_DEPTH) {
                problem("The routine nests groups more than " + MAX_DEPTH + " deep.");
                return steps;
            }
            for (Object item : list(json, "routine steps", MAX_STEPS)) {
                if (++this.steps > MAX_STEPS) {
                    problem("The routine has more than " + MAX_STEPS + " steps.");
                    return steps;
                }
                Map<String, Object> map = object(item);
                String kind = map == null ? null : text(map, "kind", 20);
                if (kind == null) {
                    problem("A routine step has no kind.");
                    continue;
                }
                switch (kind) {
                    case "path": {
                        String path = text(map, "path", 80);
                        if (path == null || !pathIds.contains(path)) problem("A routine step follows a path the program does not have.");
                        else steps.add(new Step(kind, path, 0, null, null, null));
                        break;
                    }
                    case "wait": {
                        double ms = number(map.get("ms"));
                        if (!(ms >= 0 && ms <= MAX_WAIT_MS)) problem("A wait in the routine is shorter than 0 or longer than 10 minutes.");
                        else steps.add(new Step(kind, null, ms, null, null, null));
                        break;
                    }
                    case "state": {
                        String mechanismId = text(map, "mechanism", 80);
                        String stateId = text(map, "state", 80);
                        Mechanism mechanism = null;
                        for (Mechanism candidate : mechanisms) if (candidate.id.equals(mechanismId)) mechanism = candidate;
                        if (mechanism == null || !hasState(mechanism, stateId)) {
                            problem("A routine step sets a mechanism state the program does not have.");
                            break;
                        }
                        Map<String, Object> duration = format >= 2 ? object(map.get("duration")) : null;
                        if (duration == null) {
                            if (format >= 2 && map.get("duration") != null) problem("A timed step in the routine has a duration that is not an object.");
                            else steps.add(new Step(kind, null, 0, mechanismId, stateId, null));
                            break;
                        }
                        double ms = duration(duration);
                        String then = text(duration, "then", 80);
                        if (!hasState(mechanism, then)) problem("A timed step in the routine sets \"" + mechanism.name + "\" to a state it does not have when its time is up.");
                        else if (!Double.isNaN(ms)) steps.add(new Step(kind, null, 0, mechanismId, stateId, null, null, null, ms, then, Double.NaN));
                        break;
                    }
                    case "device": {
                        if (format < 2) {
                            problem("A routine step is a \"device\", which format " + format + " programs do not have.");
                            break;
                        }
                        String name = text(map, "device", 80);
                        Device device = name == null ? null : devices.get(name);
                        if (device == null) {
                            problem("A routine step sets a device the program does not list.");
                            break;
                        }
                        Output output = output(map.get("output"), device, "A routine step");
                        if (output == null) break;
                        Object timing = map.get("duration");
                        if (timing == null) {
                            steps.add(new Step(kind, null, 0, null, null, null, device.name, output, 0, null, Double.NaN));
                            break;
                        }
                        Map<String, Object> duration = object(timing);
                        double ms = duration == null ? Double.NaN : duration(duration);
                        double then = Double.NaN;
                        if ("servo".equals(device.kind)) {
                            then = duration == null || duration.get("thenPosition") == null ? 0 : number(duration.get("thenPosition"));
                            if (!(then >= 0 && then <= 1)) problem("A timed step in the routine moves \"" + device.name + "\" to a position outside 0 to 1 when its time is up.");
                        }
                        if (duration == null) problem("A timed step in the routine has a duration that is not an object.");
                        else if (!Double.isNaN(ms) && (Double.isNaN(then) || (then >= 0 && then <= 1))) {
                            steps.add(new Step(kind, null, 0, null, null, null, device.name, output, ms, null, then));
                        }
                        break;
                    }
                    case "together":
                    case "race":
                        steps.add(new Step(kind, null, 0, null, null, Collections.unmodifiableList(steps(map.get("steps"), depth + 1, pathIds, mechanisms))));
                        break;
                    default:
                        problem("A routine step is a \"" + kind + "\", which Lumière Live does not know.");
                }
            }
            return steps;
        }

        /** A timed step's time in milliseconds, or NaN (with a problem) when it is not above 0 and at most 10 minutes. */
        double duration(Map<String, Object> duration) {
            double ms = number(duration.get("ms"));
            if (ms > 0 && ms <= MAX_WAIT_MS) return ms;
            problem("A timed step in the routine lasts 0 or less, or longer than 10 minutes.");
            return Double.NaN;
        }

        static boolean hasState(Mechanism mechanism, String stateId) {
            if (stateId == null) return false;
            for (State state : mechanism.states) if (state.id.equals(stateId)) return true;
            return false;
        }

        Pose pose(Object json, String label) {
            Map<String, Object> map = object(json);
            double x = map == null ? Double.NaN : number(map.get("x"));
            double y = map == null ? Double.NaN : number(map.get("y"));
            double heading = map == null ? Double.NaN : number(map.get("headingDeg"));
            if (!inField(x) || !inField(y) || !(Math.abs(heading) <= 100_000)) {
                problem(label + " is missing, off the field, or has no heading.");
                return null;
            }
            return new Pose(x, y, heading);
        }

        Point point(Object json, String label) {
            Map<String, Object> map = object(json);
            double x = map == null ? Double.NaN : number(map.get("x"));
            double y = map == null ? Double.NaN : number(map.get("y"));
            if (!inField(x) || !inField(y)) {
                problem(label + " is missing or off the field.");
                return null;
            }
            return new Point(x, y);
        }

        double angle(Object json, String label) {
            double value = number(json);
            if (!(Math.abs(value) <= 100_000)) {
                problem(label + " has a heading that is not a number of degrees.");
                return 0;
            }
            return value;
        }

        List<Object> list(Object json, String what, int max) {
            if (json == null) return Collections.emptyList();
            if (!(json instanceof List)) {
                problem("The program's " + what + " are not a list.");
                return Collections.emptyList();
            }
            @SuppressWarnings("unchecked")
            List<Object> items = (List<Object>) json;
            if (items.size() > max) {
                problem("The program has more than " + max + " " + what + ".");
                return items.subList(0, max);
            }
            return items;
        }

        static boolean inField(double value) {
            return value >= FIELD_MIN && value <= FIELD_MAX;
        }

        @SuppressWarnings("unchecked")
        static Map<String, Object> object(Object json) {
            return json instanceof Map ? (Map<String, Object>) json : null;
        }

        static String text(Map<String, Object> map, String key, int max) {
            Object value = map.get(key);
            return value instanceof String && ((String) value).length() <= max ? (String) value : null;
        }

        static double number(Object json) {
            return json instanceof Number ? ((Number) json).doubleValue() : Double.NaN;
        }
    }
}
